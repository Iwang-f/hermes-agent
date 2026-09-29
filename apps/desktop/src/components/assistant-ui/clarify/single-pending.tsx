'use client'

import { useStore } from '@nanostores/react'
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Loader2, MessageQuestion } from '@/lib/icons'
import { isSubmitEnter } from '@/lib/ime'
import { visibleClarifyCard } from '@/lib/keybinds/composer-focus-keys'
import { cn } from '@/lib/utils'
import { type ClarifyRequest, clearClarifyRequest } from '@/store/clarify'
import { $gateway } from '@/store/gateway'
import { reconnectAction } from '@/store/gateway-reconnect'
import { notifyError } from '@/store/notifications'
import { respondToServerRequest } from '@/store/server-requests'

import { ChoiceButton, KeyBadge, letterFor, OPTION_ROW_CLASS } from './core/choice-row'
import { CLARIFY_TEXTAREA_CLASS, ClarifyShell } from './core/shell'
import type { ClarifyArgs } from './parse'
import { handleClarifySubmitShortcut } from './submit-shortcut'
import { UndeliveredNotice } from './undelivered-notice'

export function ClarifyToolSinglePending({
  fromArgs,
  onAnswered,
  request,
  undelivered
}: {
  fromArgs: ClarifyArgs
  onAnswered: () => void
  request: ClarifyRequest | null
  undelivered: boolean
}) {
  const { t } = useI18n()
  const copy = t.assistant.clarify
  const gateway = useStore($gateway)

  const matchingRequest = useMemo(() => {
    if (!request || request.questions?.length) {
      return null
    }

    if (fromArgs.question && request.question && fromArgs.question !== request.question) {
      return null
    }

    return request
  }, [fromArgs.question, request])

  const question = fromArgs.question || matchingRequest?.question || ''

  const choices = useMemo(
    // Prefer the gateway request's choices over the raw tool args: the backend
    // labels the recommended option there (`mark_recommended`), and the card
    // only renders once `matchingRequest` exists, so the args are a fallback
    // for a hydration race, not the normal path.
    () => matchingRequest?.choices ?? fromArgs.choices ?? [],
    [fromArgs.choices, matchingRequest?.choices]
  )

  const hasChoices = choices.length > 0
  const multiSelect = hasChoices && Boolean(matchingRequest?.multiSelect ?? fromArgs.multiSelect)

  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [selectedChoices, setSelectedChoices] = useState<string[]>([])
  // The keyboard cursor. Indices 0..choices.length-1 are the options; the
  // trailing index (=== choices.length) is the "Other" free-text row.
  const [activeIndex, setActiveIndex] = useState(0)
  const [otherFocused, setOtherFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  // Identity for the visible-card check below — this is the element carrying
  // `data-clarify-choices`, i.e. the one `visibleClarifyCard()` resolves.
  const formRef = useRef<HTMLFormElement | null>(null)

  // Race: tool.start fires a tick before clarify.request, so request_id
  // arrives slightly after the tool block mounts. If the question text is
  // already in the tool args, paint the card immediately (disabled until
  // the request is wired) — a spinner→question swap is a layout jump for
  // no reason. Only spin when we have nothing to show yet.
  const ready = Boolean(matchingRequest?.requestId)
  const loading = !ready && !submitting && !question

  const respond = useCallback(
    async (answer: string) => {
      if (!ready || !matchingRequest) {
        notifyError(new Error(copy.notReady), copy.sendFailed)

        return
      }

      if (!gateway) {
        notifyError(new Error(copy.gatewayDisconnected), copy.sendFailed, { action: reconnectAction() })

        return
      }

      setSubmitting(true)

      try {
        // The response frame goes back over the socket the request arrived on —
        // the owner backend by construction (#91684's class cannot recur).
        respondToServerRequest(matchingRequest.requestId, { answer })
        triggerHaptic('submit')
        onAnswered()
        clearClarifyRequest(matchingRequest.requestId, matchingRequest.sessionId)
        // tool.complete lands next → ClarifyToolSettled.
      } catch (error) {
        notifyError(error, copy.sendFailed)
        setSubmitting(false)
      }
    },
    [copy.gatewayDisconnected, copy.notReady, copy.sendFailed, gateway, matchingRequest, onAnswered, ready]
  )

  const trimmedDraft = draft.trim()
  // The answer is whichever input is active: a picked choice, or typed text.
  // Picking a choice no longer fires immediately — it selects, then the user
  // confirms with Continue (or Enter from the field). Multi-select treats the
  // typed text as one more answer alongside whatever is already picked.
  const multiSelectAnswers = multiSelect && trimmedDraft ? [...selectedChoices, trimmedDraft] : selectedChoices

  const selectedAnswer = multiSelect
    ? multiSelectAnswers.length > 0
      ? JSON.stringify(multiSelectAnswers)
      : null
    : (selectedChoices[0] ?? null)

  const pendingAnswer = selectedAnswer ?? (trimmedDraft || null)

  const selectChoice = useCallback(
    (choice: string, index: number) => {
      // Picking a choice and typing are mutually exclusive answers in
      // single-select; multi-select keeps the typed text as one more answer.
      if (!multiSelect) {
        setDraft('')
      }

      setSelectedChoices(selected => {
        if (!multiSelect) {
          return [choice]
        }

        return selected.includes(choice) ? selected.filter(value => value !== choice) : [...selected, choice]
      })
      setActiveIndex(index)
    },
    [multiSelect]
  )

  // Keep the cursor in range when the choice set changes (never past "Other").
  useEffect(() => {
    setActiveIndex(index => Math.min(index, choices.length))
  }, [choices.length])

  const moveActive = useCallback(
    (delta: number) => {
      const itemCount = choices.length + 1

      // Arrow navigation is a move, not a pick. Multi-select keeps staged
      // choices and the typed text while the cursor moves so the user can
      // build a set; the single-select path retains its existing
      // clear-on-navigation behaviour.
      if (!multiSelect) {
        setDraft('')
        setSelectedChoices([])
      }

      setActiveIndex(index => (index + delta + itemCount) % itemCount)
    },
    [choices.length, multiSelect]
  )

  const submitAnswer = useCallback(() => {
    if (pendingAnswer) {
      void respond(pendingAnswer)
    }
  }, [pendingAnswer, respond])

  const activateActive = useCallback(() => {
    const choice = choices[activeIndex]

    // Multi-select Enter toggles the highlighted choice. The user confirms the
    // staged set explicitly with Continue so this path never submits a scalar.
    if (multiSelect && choice) {
      selectChoice(choice, activeIndex)

      return
    }

    // A staged answer (picked choice or typed text) wins — confirm it.
    if (pendingAnswer) {
      submitAnswer()

      return
    }

    // Otherwise act on the highlighted row: a choice responds immediately, and
    // the trailing "Other" row focuses the free-text field.
    if (choice) {
      void respond(choice)

      return
    }

    textareaRef.current?.focus()
  }, [activeIndex, choices, multiSelect, pendingAnswer, respond, selectChoice, submitAnswer])

  const handleTextareaKey = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isSubmitEnter(event) && !event.shiftKey) {
        event.preventDefault()
        submitAnswer()
      }
    },
    [submitAnswer]
  )

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      submitAnswer()
    },
    [submitAnswer]
  )

  // Arrow keys move a visual cursor, 1-9 and A/B/C… pick directly, and Enter
  // confirms the current answer (or acts on the highlighted row). A focused
  // choice row stays in this handler so Enter reaches activateActive: that
  // submits a staged single-select answer and toggles a multi-select row.
  // Every other focused control (the Other box, Skip, Continue, the composer)
  // keeps its own keys. Inactive cards stand down too — the binding is
  // window-wide but the answer is session-specific.
  useEffect(() => {
    if (!ready || !hasChoices || submitting) {
      return
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) {
        return
      }

      // Not the visible card ⇒ not our keystroke. Inactive tabs stay MOUNTED,
      // so every parked clarify keeps a live `window` listener; without this the
      // card that acts is whichever mounted first, and answering the question in
      // front of you silently answers a background session's question instead —
      // resuming an agent turn the user never saw. Same resolver the composer's
      // `clarifyCardOwnsKey` yields to, so the two cannot disagree about which
      // card is live.
      if (visibleClarifyCard() !== formRef.current) {
        return
      }

      const active = document.activeElement as HTMLElement | null

      if (
        active &&
        (active.isContentEditable ||
          (active.matches('a[href], button, input, select, textarea, [role="button"]') &&
            // Choice rows stay in this handler so Enter reaches activateActive.
            // That submits a staged single-select answer and toggles a
            // multi-select row. Skip, Continue, and the Other field stay
            // hands-off.
            !active.matches('button[data-choice]')))
      ) {
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        moveActive(event.key === 'ArrowDown' ? 1 : -1)

        return
      }

      if (/^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1

        if (index < choices.length) {
          event.preventDefault()
          selectChoice(choices[index], index)
        } else if (index === choices.length) {
          event.preventDefault()
          setActiveIndex(index)
          textareaRef.current?.focus()
        }

        return
      }

      const key = event.key.toLowerCase()

      // Only the letters this card actually renders a row for. Anything past
      // the last row belongs to the composer — the user is typing a message
      // instead of picking an option, and swallowing the keystroke here would
      // make the first letter of it vanish.
      if (key.length === 1 && key >= 'a' && key <= 'z') {
        const index = key.charCodeAt(0) - 97

        if (index < choices.length) {
          event.preventDefault()
          selectChoice(choices[index], index)
        } else if (index === choices.length) {
          event.preventDefault()
          setActiveIndex(index)
          textareaRef.current?.focus()
        }

        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        activateActive()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activateActive, choices, hasChoices, moveActive, ready, selectChoice, submitting])

  if (loading) {
    return (
      <ClarifyShell aria-label={copy.loadingQuestion} className="my-1.5 grid min-h-12 place-items-center" role="status">
        <Loader aria-hidden="true" className="size-6 text-(--ui-text-tertiary)" role="presentation" type="rose-curve" />
      </ClarifyShell>
    )
  }

  const onDraftChange = (value: string) => {
    setDraft(value)

    // Typing is its own answer — drop any picked choice so the two inputs can't
    // both look selected. Multi-select allows both: the typed text becomes an
    // additional answer instead of replacing the picked choices.
    if (value.trim() && !multiSelect) {
      setSelectedChoices([])
    }
  }

  return (
    // `data-clarify-choices` marks the panel as owning its OWN shortcut keys
    // (Enter, and 1..N+1 / A.. for the N choices plus "Other") while they're
    // live, so the global type-to-focus listener (`clarifyCardOwnsKey`) yields
    // exactly those and lets every other printable through to the composer —
    // typing a real message instead of picking an option stays possible. The
    // value is the choice count so the check needs no store access.
    //
    // The form is the outer element so the actions can sit OUTSIDE the card and
    // still submit it — the panel holds the question, the buttons ride below it.
    <form
      className="my-1.5 grid gap-4"
      data-clarify-choices={hasChoices ? choices.length : undefined}
      onKeyDownCapture={handleClarifySubmitShortcut}
      onSubmit={handleSubmit}
      ref={formRef}
    >
      <ClarifyShell className="grid gap-2">
        <div className="flex items-start gap-2">
          <span className="flex-1 whitespace-pre-wrap font-medium leading-(--conversation-line-height)">
            {question}
          </span>
          <MessageQuestion aria-hidden className="mt-px size-4 shrink-0 text-(--ui-text-tertiary)" />
        </div>
        {undelivered ? <UndeliveredNotice /> : null}

        {hasChoices ? (
          <div className="grid gap-px" role="group">
            {choices.map((choice, index) => (
              <ChoiceButton
                active={!undelivered && activeIndex === index}
                char={letterFor(index)}
                choice={choice}
                disabled={submitting || !ready}
                key={`${index}-${choice}`}
                keyShortcuts={`${letterFor(index)} ${index + 1}`}
                onClick={() => selectChoice(choice, index)}
                selected={selectedChoices.includes(choice)}
              />
            ))}
            <label
              className={cn(
                OPTION_ROW_CLASS,
                'items-center',
                !undelivered && activeIndex === choices.length && 'bg-(--chrome-action-hover)'
              )}
              data-highlighted={(!undelivered && activeIndex === choices.length) || undefined}
            >
              <KeyBadge
                char={letterFor(choices.length)}
                disabled={submitting || !ready}
                preview={!undelivered && (otherFocused || activeIndex === choices.length)}
                selected={Boolean(trimmedDraft)}
              />
              <Textarea
                aria-current={activeIndex === choices.length || undefined}
                aria-keyshortcuts={`${letterFor(choices.length)} ${choices.length + 1}`}
                className={CLARIFY_TEXTAREA_CLASS}
                disabled={submitting || !ready}
                onBlur={() => setOtherFocused(false)}
                onChange={event => onDraftChange(event.target.value)}
                onFocus={() => {
                  if (!multiSelect) {
                    setSelectedChoices([])
                  }

                  setActiveIndex(choices.length)
                  setOtherFocused(true)
                }}
                onKeyDown={handleTextareaKey}
                placeholder={copy.other}
                ref={textareaRef}
                rows={1}
                size="sm"
                value={draft}
              />
            </label>
          </div>
        ) : (
          <Textarea
            className={CLARIFY_TEXTAREA_CLASS}
            disabled={submitting || !ready}
            onChange={event => onDraftChange(event.target.value)}
            onKeyDown={handleTextareaKey}
            placeholder={copy.placeholder}
            ref={textareaRef}
            rows={1}
            size="sm"
            value={draft}
          />
        )}
      </ClarifyShell>

      {/* Nothing here can answer an undelivered request — drop the actions
          like the settled card does rather than leave a dead primary button. */}
      {undelivered ? null : (
        <div className="flex items-center justify-end gap-1">
          <Button
            disabled={submitting || !ready}
            onClick={() => void respond('')}
            size="xs"
            type="button"
            variant="text"
          >
            {copy.skip}
          </Button>
          <Button disabled={submitting || !ready || !pendingAnswer} size="xs" type="submit">
            {submitting ? (
              <Loader2 className="animate-spin" />
            ) : (
              <>
                {copy.continueLabel}
                <span aria-hidden className="ml-0.5 text-[0.625rem] opacity-70">
                  ⏎
                </span>
              </>
            )}
          </Button>
        </div>
      )}
    </form>
  )
}
