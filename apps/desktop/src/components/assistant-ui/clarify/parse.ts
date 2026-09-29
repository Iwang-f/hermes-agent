import { normalizeChoices, warnDroppedChoices } from '@/store/clarify'

import { parseMaybeObject } from '../tool/fallback-model/format'

export interface ClarifyArgs {
  question?: string
  choices?: string[] | null
  multiSelect?: boolean
  questions?: { question: string; choices?: string[] | null; multiSelect?: boolean }[]
}

export interface ClarifyResult {
  question?: string
  answer?: string
  error?: string
}

function stringField(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key]

    if (typeof value === 'string') {
      return value
    }
  }
}

export function readClarifyArgs(args: unknown): ClarifyArgs {
  const row = parseMaybeObject(args)
  const rawChoices = row.choices
  const choices = normalizeChoices(rawChoices)

  const question = stringField(row, 'question')

  if (rawChoices != null && choices.length === 0 && question) {
    warnDroppedChoices('tool_args', question, rawChoices)
  }

  // Batch form: tool args carry the model's questions array. Entries are
  // normalized leniently here (qid comes from the gateway request, not args).
  let questions: ClarifyArgs['questions']

  if (Array.isArray(row.questions)) {
    const parsed = row.questions
      .map(entry => {
        const item = parseMaybeObject(entry)
        const text = stringField(item, 'question')

        if (!text) {
          return null
        }

        const itemChoices = normalizeChoices(item.choices)

        return {
          choices: itemChoices.length > 0 ? itemChoices : null,
          multiSelect: item.multi_select === true && itemChoices.length > 0,
          question: text
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

    if (parsed.length > 0) {
      questions = parsed
    }
  }

  return {
    question,
    choices: choices.length > 0 ? choices : null,
    multiSelect: row.multi_select === true,
    questions
  }
}

export interface ClarifyBatchResponse {
  id?: string
  question?: string
  answer?: string | string[]
}

/** Parse batch clarify tool JSON (`responses` array + optional timed_out). */
export function readClarifyBatchResult(result: unknown): {
  responses: ClarifyBatchResponse[]
  timedOut: boolean
} {
  const row = parseMaybeObject(result)

  if (!Array.isArray(row.responses)) {
    return { responses: [], timedOut: false }
  }

  const responses = row.responses.map((entry): ClarifyBatchResponse => {
    const item = parseMaybeObject(entry)
    const answer = item.user_response

    return {
      answer: Array.isArray(answer) ? answer.map(String) : typeof answer === 'string' ? answer : undefined,
      id: stringField(item, 'id'),
      question: stringField(item, 'question')
    }
  })

  return { responses, timedOut: row.timed_out === true }
}

/** Parse clarify tool JSON (`question` + `user_response`). */
export function readClarifyResult(result: unknown): ClarifyResult {
  const row = parseMaybeObject(result)

  if (Object.keys(row).length === 0) {
    return typeof result === 'string' && result.trim() ? { answer: result.trim() } : {}
  }

  return {
    question: stringField(row, 'question'),
    answer: stringField(row, 'user_response', 'answer'),
    error: stringField(row, 'error')
  }
}
