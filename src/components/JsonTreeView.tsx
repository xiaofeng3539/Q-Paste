import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface JsonTreeViewProps {
  data: unknown
  defaultExpandedDepth?: number
  expandAllSignal?: { expanded: boolean; version: number }
}

interface JsonNodeProps {
  name?: string
  value: unknown
  depth: number
  isLast: boolean
  defaultExpandedDepth: number
  expandAllSignal?: { expanded: boolean; version: number }
}

function JsonNode({ name, value, depth, isLast, defaultExpandedDepth, expandAllSignal }: JsonNodeProps) {
  const isObject = value !== null && typeof value === 'object'
  const isArray = Array.isArray(value)
  const entries: Array<[string, unknown]> = isObject
    ? isArray
      ? value.map((v, i) => [String(i), v])
      : Object.entries(value as Record<string, unknown>)
    : []

  const [localExpanded, setLocalExpanded] = useState<boolean>(depth < defaultExpandedDepth)
  const [lastSignalVersion, setLastSignalVersion] = useState(expandAllSignal?.version ?? 0)

  let expanded = localExpanded
  if (expandAllSignal && expandAllSignal.version !== lastSignalVersion) {
    expanded = expandAllSignal.expanded
    setLocalExpanded(expandAllSignal.expanded)
    setLastSignalVersion(expandAllSignal.version)
  }

  const comma = isLast ? '' : ','
  const keyPrefix = name !== undefined ? (
    <>
      <span className="text-sky-700 dark:text-sky-300">"{name}"</span>
      <span className="text-zinc-500 dark:text-zinc-400">: </span>
    </>
  ) : null

  if (!isObject) {
    let valEl: React.ReactNode
    if (typeof value === 'string') {
      valEl = <span className="text-emerald-700 dark:text-emerald-300 break-all">"{value}"</span>
    } else if (typeof value === 'number') {
      valEl = <span className="text-amber-700 dark:text-amber-300">{String(value)}</span>
    } else if (typeof value === 'boolean') {
      valEl = <span className="text-purple-700 dark:text-purple-300">{String(value)}</span>
    } else {
      valEl = <span className="text-zinc-400 dark:text-zinc-500 italic">null</span>
    }
    return (
      <div className="leading-6 pl-4">
        {keyPrefix}
        {valEl}
        <span className="text-zinc-400 dark:text-zinc-500">{comma}</span>
      </div>
    )
  }

  const openBrace = isArray ? '[' : '{'
  const closeBrace = isArray ? ']' : '}'

  if (entries.length === 0) {
    return (
      <div className="leading-6 pl-4">
        {keyPrefix}
        <span className="text-zinc-600 dark:text-zinc-400">{openBrace}{closeBrace}</span>
        <span className="text-zinc-400 dark:text-zinc-500">{comma}</span>
      </div>
    )
  }

  return (
    <div className="leading-6">
      <button
        type="button"
        onClick={() => setLocalExpanded((v) => !v)}
        className="inline-flex items-center gap-0.5 text-left rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-800/80 px-0.5 -ml-0.5 transition-colors"
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />}
        <span>
          {keyPrefix}
          <span className="text-zinc-600 dark:text-zinc-400">{openBrace}</span>
          {!expanded && (
            <>
              <span className="mx-1 px-1 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 text-[10px] text-zinc-500 dark:text-zinc-400">
                {isArray ? `${entries.length} 项` : `${entries.length} 键`}
              </span>
              <span className="text-zinc-600 dark:text-zinc-400">{closeBrace}</span>
              <span className="text-zinc-400 dark:text-zinc-500">{comma}</span>
            </>
          )}
        </span>
      </button>
      {expanded && (
        <div className="pl-4 border-l border-zinc-200/80 dark:border-zinc-700/60 ml-1.5">
          {entries.map(([k, v], idx) => (
            <JsonNode
              key={`${k}-${idx}`}
              name={isArray ? undefined : k}
              value={v}
              depth={depth + 1}
              isLast={idx === entries.length - 1}
              defaultExpandedDepth={defaultExpandedDepth}
              expandAllSignal={expandAllSignal}
            />
          ))}
        </div>
      )}
      {expanded && (
        <div className="pl-4">
          <span className="text-zinc-600 dark:text-zinc-400">{closeBrace}</span>
          <span className="text-zinc-400 dark:text-zinc-500">{comma}</span>
        </div>
      )}
    </div>
  )
}

export default function JsonTreeView({ data, defaultExpandedDepth = 2, expandAllSignal }: JsonTreeViewProps) {
  return (
    <div
      data-testid="json-tree-view"
      className="font-mono text-xs select-text rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50/90 dark:bg-zinc-950/60 p-3 overflow-x-auto"
    >
      <JsonNode
        value={data}
        depth={0}
        isLast={true}
        defaultExpandedDepth={defaultExpandedDepth}
        expandAllSignal={expandAllSignal}
      />
    </div>
  )
}
