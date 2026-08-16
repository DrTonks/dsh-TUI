/**
 * Regression: opening, advancing, and closing an inline questionnaire must
 * not copy the startup splash into terminal scrollback (issues #19/#38/#69).
 */
process.env.FORCE_COLOR = '3'
process.env.TERM_PROGRAM = 'WezTerm'
process.env.DSH_TUI_THEME = 'dark'
process.env.DSH_TUI_LANG = 'zh'

const [{ PassThrough, Writable }, React, { Terminal: XTerm }, { render }, { Chat }, { QuestionStore }] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../src/ui.js'),
  import('../src/screens/Chat.js'),
  import('../src/dsh-adapter/questions.js'),
])

const COLS = 100
const ROWS = 24
const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 2000, allowProposedApi: true })
const rawChunks: string[] = []

class FakeStdout extends Writable {
  columns = COLS
  rows = ROWS
  isTTY = true
  _write(chunk: unknown, _encoding: BufferEncoding, callback: () => void) {
    const text = String(chunk)
    rawChunks.push(text)
    term.write(text, callback)
  }
}

class FakeStdin extends PassThrough {
  isTTY = true
  setRawMode() { return this }
  ref() { return this }
  unref() { return this }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const longOptions = Array.from({ length: 18 }, (_, index) => ({
  label: `运行环境 ${index + 1}`,
  description: `第 ${index + 1} 个运行环境的独立说明。`,
}))
const listeners = new Set<() => void>()
const channel: any = {
  version: 0,
  rows: [
    { id: 0, kind: 'user', text: '帮我检查配置' },
    { id: 1, kind: 'assistant', text: '我先确认几个选项。', streaming: false },
  ],
  status: 'idle',
  sessionTitle: 'question-scrollback',
  agentId: 'probe',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'max',
  tokens: { input: 120, output: 45 },
  cwd: 'C:/code/demo-project',
  displayCwd: 'C:/code/demo-project',
  gitBranch: 'main',
  working: true,
  spinnerMode: 'requesting',
  responseChars: 20,
  activeToolCount: 0,
  mode: { id: 'default', plan: false },
  modeIndex: 0,
  cycleMode() {},
  turnStart: Date.now(),
  lastUserText: '帮我检查配置',
  pending: [],
  commandList: [],
  notifications: [],
  activityEnabled: true,
  contextBarEnabled: true,
  activityFrames: [],
  workingActivity: {
    phase: 'asking',
    line: '等待回答',
    toolCount: 0,
    turnElapsedMs: 1000,
    phaseStartedAt: Date.now() - 1000,
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
  submit() {},
  cancel() {},
  clear() {},
  notify() {},
  pushLocal() {},
  listModels: () => Promise.resolve([]),
  listSessions: () => [],
  setResumeTarget() {},
  loadOlder() {},
  mcpStatus: () => [],
}

const store = new QuestionStore()
const stdout = new FakeStdout() as FakeStdout & NodeJS.WriteStream
const stdin = new FakeStdin() as FakeStdin & NodeJS.ReadStream
const app = await render(
  <Chat channel={channel} questionStore={store} onExit={() => {}} />,
  { stdout, stdin, stderr: stdout, exitOnCtrlC: false, patchConsole: false },
)

function splashCount(): number {
  const buffer = term.buffer.active
  let count = 0
  for (let y = 0; y < buffer.length; y++) {
    if ((buffer.getLine(y)?.translateToString(true) ?? '').includes('探索未至')) count += 1
  }
  return count
}

function visibleText(): string {
  const buffer = term.buffer.active
  return Array.from({ length: ROWS }, (_, offset) =>
    buffer.getLine(buffer.baseY + offset)?.translateToString(true) ?? '').join('\n')
}

let failures = 0
let initialBufferLength = 0
function check(stage: string, exact = false) {
  const count = splashCount()
  const ok = exact ? count === 1 : count <= 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${stage}: splash copies=${count}, buffer lines=${term.buffer.active.length}`)
  if (!ok) failures += 1
}

function checkBufferStable(stage: string) {
  const length = term.buffer.active.length
  const ok = length === initialBufferLength
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${stage}: buffer lines=${length}`)
  if (!ok) failures += 1
}

function checkVisible(stage: string, marker: string) {
  const ok = visibleText().includes(marker)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${stage}`)
  if (!ok) failures += 1
}

await sleep(600)
initialBufferLength = term.buffer.active.length
check('initial render', true)

const answer = store.ask({
  questions: [
    {
      id: 'runtime',
      header: '运行环境',
      question: '使用哪个运行环境？',
      options: longOptions,
    },
    {
      id: 'confirm',
      header: '确认',
      question: '继续执行吗？',
      options: [
        { label: '继续', description: '应用当前配置。' },
        { label: '取消', description: '保持现状。' },
      ],
    },
  ],
} as never)
await sleep(500)
check('question opened')
checkBufferStable('question open does not grow scrollback')
checkVisible('first question remains visible', '使用哪个运行环境？')

stdin.write('\r')
await sleep(500)
check('advanced to second question')
checkBufferStable('question advance does not grow scrollback')
checkVisible('second question remains visible', '继续执行吗？')

stdin.write('\r')
await answer
await sleep(500)
check('questionnaire closed', true)
checkBufferStable('question close does not grow scrollback')

const scrollUps = (rawChunks.join('').match(/\x1b\[\d+S/g) ?? []).length
console.log(`scroll-up sequences=${scrollUps}`)

await app.unmount()
process.exit(failures === 0 ? 0 : 1)
