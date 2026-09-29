'use client'

import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { useCallback, useMemo } from 'react'

import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { CircleLetterA, MessageQuestion } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { ChoiceButton, letterFor } from './core/choice-row'
import { ClarifyLine, ClarifyShell } from './core/shell'
import { readClarifyArgs, readClarifyBatchResult, readClarifyResult } from './parse'

export function ClarifyToolSettled(props: ToolCallMessagePartProps) {
  const batch = readClarifyBatchResult(props.result)

  if (batch.responses.length > 0) {
    return <ClarifyToolBatchSettled responses={batch.responses} />
  }

  return <ClarifyToolSingleSettled {...props} />
}

export function ClarifyToolSingleSettled({ args, result }: ToolCallMessagePartProps) {
  const { t } = useI18n()
  const copy = t.assistant.clarify
  const fromArgs = useMemo(() => readClarifyArgs(args), [args])
  const fromResult = useMemo(() => readClarifyResult(result), [result])

  const question = fromResult.question || fromArgs.question || ''
  const answer = fromResult.answer
  const error = fromResult.error
  const skipped = !error && answer !== undefined && !answer.trim()
  const answerText = error || (skipped ? copy.skipped : (answer ?? '').trim())
  const choices = fromArgs.choices ?? []

  // A skipped (timed-out) clarify keeps its choices on screen and actionable.
  // The blocking request is long gone — the tool already returned empty — so a
  // pick can't resolve it retroactively. Instead it drafts a quoted follow-up
  // into the composer (Enter sends; if the agent is mid-turn it queues like
  // any other prompt). Without this the card collapsed to just "Skipped" and
  // the options were unrecoverable.
  const followUp = useCallback(
    (choice: string) => {
      requestComposerInsert(copy.lateAnswer(question, choice), { mode: 'block' })
      requestComposerFocus()
      triggerHaptic('selection')
    },
    [copy, question]
  )

  return (
    <ClarifyShell className="my-1.5 grid gap-1.5" data-clarify-settled="">
      {question ? (
        <ClarifyLine icon={MessageQuestion}>
          <span className="whitespace-pre-wrap font-medium leading-(--conversation-line-height)">{question}</span>
        </ClarifyLine>
      ) : null}
      {answerText ? (
        <ClarifyLine icon={CircleLetterA}>
          <p
            className={cn(
              'whitespace-pre-wrap leading-(--conversation-line-height)',
              error ? 'text-destructive' : 'text-(--ui-text-secondary)',
              skipped && 'italic text-(--ui-text-tertiary)'
            )}
            data-clarify-answer=""
          >
            {answerText}
          </p>
        </ClarifyLine>
      ) : null}
      {skipped && choices.length > 0 ? (
        <div className="grid gap-px" data-clarify-late-choices="" role="group">
          {choices.map((choice, index) => (
            <ChoiceButton
              char={letterFor(index)}
              choice={choice}
              key={`${index}-${choice}`}
              onClick={() => followUp(choice)}
              title={copy.lateAnswerTip}
            />
          ))}
          <p className="px-1.5 pt-0.5 text-[0.6875rem] leading-4 text-(--ui-text-tertiary)">{copy.lateAnswerHint}</p>
        </div>
      ) : null}
    </ClarifyShell>
  )
}

// ─── Batch (multi-question) clarify ─────────────────────────────────────────

/** Settled batch card: every question with its locked (or absent) answer. */
export function ClarifyToolBatchSettled({ responses }: { responses: { question?: string; answer?: string | string[] }[] }) {
  const { t } = useI18n()
  const copy = t.assistant.clarify

  return (
    <ClarifyShell className="my-1.5 grid gap-2.5" data-clarify-settled="">
      {responses.map((row, index) => {
        const answer = Array.isArray(row.answer) ? row.answer.join(', ') : (row.answer ?? '')
        const blank = !answer.trim()

        return (
          <div className="grid gap-1" key={`${index}-${row.question ?? ''}`}>
            {row.question ? (
              <ClarifyLine icon={MessageQuestion}>
                <span className="whitespace-pre-wrap font-medium leading-(--conversation-line-height)">
                  {row.question}
                </span>
              </ClarifyLine>
            ) : null}
            <ClarifyLine icon={CircleLetterA}>
              <p
                className={cn(
                  'whitespace-pre-wrap leading-(--conversation-line-height)',
                  blank ? 'italic text-(--ui-text-tertiary)' : 'text-(--ui-text-secondary)'
                )}
                data-clarify-answer=""
              >
                {blank ? copy.skipped : answer}
              </p>
            </ClarifyLine>
          </div>
        )
      })}
    </ClarifyShell>
  )
}
