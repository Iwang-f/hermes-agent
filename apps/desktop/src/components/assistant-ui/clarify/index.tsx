'use client'

import { type ToolCallMessagePartProps, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { ToolFallback } from '@/components/assistant-ui/tool/fallback'
import { sessionClarifyRequest } from '@/store/clarify'

import { selectMessageRunning } from '../tool/fallback-model'

import { ClarifyToolBatchPending } from './batch-pending'
import { readClarifyArgs } from './parse'
import { ClarifyToolSettled } from './settled'
import { ClarifyToolSinglePending } from './single-pending'
import { useUndeliveredClarify } from './use-undelivered'

export const ClarifyTool = (props: ToolCallMessagePartProps) => {
  // Answered → settled Q&A (ToolFallback collapsed the answer away).
  if (props.result !== undefined) {
    return <ClarifyToolSettled {...props} />
  }

  return <ClarifyToolPending {...props} />
}

export function ClarifyToolPending(props: ToolCallMessagePartProps) {
  // The tool row is in whichever session's transcript rendered it — read THAT
  // session's clarify (primary or tile), not the globally-active one.
  const sessionId = useStore(useSessionView().$runtimeId)
  const $request = useMemo(() => sessionClarifyRequest(sessionId), [sessionId])
  const request = useStore($request)
  const fromArgs = useMemo(() => readClarifyArgs(props.args), [props.args])
  const messageRunning = useAuiState(selectMessageRunning)
  // Answering clears the request a beat before `tool.complete` swaps in the
  // settled card. Latch submit so that gap doesn't demote; Stop also clears
  // the request and must still collapse an unanswered card.
  const [answered, setAnswered] = useState(false)
  const undelivered = useUndeliveredClarify(sessionId, messageRunning && !request && !answered)

  // Stopped mid-prompt with no result — don't leave a dead interactive panel.
  // `session.info` reports running=false while clarify is blocking, so the
  // running flag alone would remount the question as a tool row. Keep the
  // card while a request is open or this instance already submitted.
  if (!messageRunning && !request && !answered) {
    return <ToolFallback {...props} />
  }

  // Batch: the gateway request carries qid-keyed questions. Args alone can't
  // drive the form (no qids to respond with), so the live form waits for the
  // request — but the question TEXT is already in the tool args, so paint a
  // disabled preview immediately instead of a spinner (the single-question
  // card does the same while request_id races the tool block).
  if (request?.questions?.length || fromArgs.questions) {
    return (
      <ClarifyToolBatchPending
        fromArgs={fromArgs}
        onAnswered={() => setAnswered(true)}
        request={request}
        undelivered={undelivered}
      />
    )
  }

  return (
    <ClarifyToolSinglePending
      fromArgs={fromArgs}
      onAnswered={() => setAnswered(true)}
      request={request}
      undelivered={undelivered}
    />
  )
}
