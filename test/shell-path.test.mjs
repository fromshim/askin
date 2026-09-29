// Finder 로 뜬 앱의 PATH 보정(desktop/app/shell-path.mjs). 진짜 셸은 안 부른다 — exec 를 주입한다.
//   node --test test/shell-path.test.mjs
import { it } from 'node:test'
import assert from 'node:assert'
import { loginShellPath, mergePath, resolvedPath, fallbackDirs } from '../desktop/app/shell-path.mjs'

const GUI_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

it('로그인 셸의 PATH 를 rc 인사말 사이에서 표식으로 뽑는다', () => {
  const calls = []
  const exec = (bin, args, opts) => {
    calls.push({ bin, args, opts })
    return 'Welcome!\n__ASKIN_PATH__/Users/u/.local/bin:/opt/homebrew/bin:/usr/bin__ASKIN_PATH__'
  }
  assert.strictEqual(loginShellPath({ shell: '/bin/zsh', exec }), '/Users/u/.local/bin:/opt/homebrew/bin:/usr/bin')
  assert.deepStrictEqual(calls[0].args.slice(0, 1), ['-ilc'])
  assert.ok(calls[0].opts.timeout > 0, '느린 셸에 앱 시작이 묶이지 않게 제한 시간이 있어야 한다')
})

it('셸이 실패하거나 시간을 넘기면 null 이고 죽지 않는다', () => {
  const exec = () => { const e = new Error('ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e }
  assert.strictEqual(loginShellPath({ shell: '/bin/zsh', exec }), null)
  assert.strictEqual(loginShellPath({ shell: '/bin/zsh', exec: () => 'no marker' }), null)
  assert.strictEqual(loginShellPath({ shell: '' }), null)
})

it('Finder 의 최소 PATH 에 로그인 셸 값을 뒤에 붙여 claude 폴더를 찾는다', () => {
  const exec = () => '__ASKIN_PATH__/Users/u/.local/bin:/usr/bin__ASKIN_PATH__'
  const out = resolvedPath({ env: { PATH: GUI_PATH, SHELL: '/bin/zsh' }, platform: 'darwin', home: '/Users/u', exec, existsSync: () => false })
  assert.strictEqual(out, `${GUI_PATH}:/Users/u/.local/bin`)
})

it('지금 PATH 가 앞이다 — 앞에 둔 mock 폴더를 로그인 셸 값이 덮지 않는다', () => {
  const exec = () => '__ASKIN_PATH__/Users/u/.local/bin__ASKIN_PATH__'
  const out = resolvedPath({ env: { PATH: `/mock:${GUI_PATH}`, SHELL: '/bin/zsh' }, platform: 'darwin', home: '/Users/u', exec, existsSync: () => false })
  assert.ok(out.startsWith('/mock:'))
})

it('셸을 못 읽어도 흔한 설치 위치 중 있는 것만 붙인다', () => {
  const exec = () => { throw new Error('boom') }
  const exists = (d) => d === '/Users/u/.local/bin' || d === '/opt/homebrew/bin'
  const out = resolvedPath({ env: { PATH: GUI_PATH, SHELL: '/bin/zsh' }, platform: 'darwin', home: '/Users/u', exec, existsSync: exists })
  assert.strictEqual(out, `${GUI_PATH}:/Users/u/.local/bin:/opt/homebrew/bin`)
  assert.ok(fallbackDirs('/Users/u').includes('/Users/u/.claude/local'))
})

it('mergePath 는 순서를 지키고 빈 칸·중복을 뺀다', () => {
  assert.strictEqual(mergePath('a::b', ['b', 'c'], null, 'a'), 'a:b:c')
})

it('Windows 는 건드리지 않는다', () => {
  assert.strictEqual(resolvedPath({ env: { PATH: 'C:\\x' }, platform: 'win32', exec: () => { throw new Error('안 불려야 한다') } }), 'C:\\x')
})
