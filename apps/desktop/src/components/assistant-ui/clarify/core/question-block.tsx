'use client'

import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ClarifyQuestion } from '@/store/clarify'

import { ChoiceButton, KeyBadge, letterFor, OPTION_ROW_CLASS } from './choice-row'
import { CLARIFY_TEXTAREA_CLASS } from './shell'

/** One question's interactive block inside the live batch card. */
export function BatchQuestionBlock({
  disabled,
  locked,
  onDraft,
  onToggle,
  question,
  staged
}: {
  disabled: boolean
  locked: boolean
  onDraft: (value: string) => void
  onToggle: (choice: string) => void
  question: ClarifyQuestion
  staged: { choices: string[]; draft: string }
}) {
  const { t } = useI18n()
  const copy = t.assistant.clarify
  const choices = question.choices ?? []

  return (
    <div className="grid gap-1" data-clarify-batch-question={question.qid} data-locked={locked || undefined}>
      <div className="flex items-start gap-2">
        <span className="flex-1 whitespace-pre-wrap font-medium leading-(--conversation-line-height)">
          {question.question}
        </span>
        {locked ? (
          <span className="shrink-0 rounded-sm bg-(--chrome-action-hover) px-1 py-px text-[0.625rem] text-(--ui-text-tertiary)">
            ✓ {copy.answeredBadge}
          </span>
        ) : null}
      </div>

      {choices.length > 0 ? (
        <div className="grid gap-px" role="group">
          {choices.map((choice, index) => (
            <ChoiceButton
              char={letterFor(index)}
              choice={choice}
              disabled={disabled}
              key={`${index}-${choice}`}
              onClick={() => onToggle(choice)}
              selected={staged.choices.includes(choice)}
            />
          ))}
          <label className={cn(OPTION_ROW_CLASS, 'items-center')}>
            <KeyBadge char={letterFor(choices.length)} disabled={disabled} selected={Boolean(staged.draft.trim())} />
            <Textarea
              className={CLARIFY_TEXTAREA_CLASS}
              disabled={disabled}
              onChange={event => onDraft(event.target.value)}
              placeholder={copy.other}
              rows={1}
              size="sm"
              value={staged.draft}
            />
          </label>
        </div>
      ) : (
        <Textarea
          className={CLARIFY_TEXTAREA_CLASS}
          disabled={disabled}
          onChange={event => onDraft(event.target.value)}
          placeholder={copy.placeholder}
          rows={1}
          size="sm"
          value={staged.draft}
        />
      )}
    </div>
  )
}

export const emptyStage = { choices: [] as string[], draft: '' }
