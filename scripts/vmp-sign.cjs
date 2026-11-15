// electron-builder afterSign hook: VMP-sign the packaged app so Spotify (Widevine)
// plays. castLabs requires VMP signing AFTER code signing on Windows, which is why
// this runs in afterSign rather than afterPack.
//
// It uses your cached castLabs EVS login (run `python -m castlabs_evs.account reauth`
// once if it has expired). It never prompts: EVS_NO_ASK turns a missing login into
// an error. Set SKIP_VMP=1 to build without signing (Spotify won't play in that build).
/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads hooks as CommonJS */
const { execFileSync } = require('child_process')
const { existsSync, rmSync } = require('fs')
const { join } = require('path')

exports.default = async function vmpSign(context) {
  const dir = context.appOutDir
  // electron.exe.sig is the dev signature copied from node_modules; it doesn't match
  // the renamed Unison.exe and would only confuse things.
  const stale = join(dir, 'electron.exe.sig')
  if (existsSync(stale)) rmSync(stale)

  if (process.env.SKIP_VMP === '1') {
    console.warn('  • SKIP_VMP=1: not VMP-signing. Spotify playback will not work in this build.')
    return
  }
  console.log(`  • VMP-signing ${dir}`)
  try {
    execFileSync('python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', dir], {
      stdio: 'inherit',
      env: { ...process.env, EVS_NO_ASK: '1' }
    })
  } catch {
    throw new Error(
      'VMP signing failed. Log in with `python -m castlabs_evs.account reauth`, then build again ' +
        '(or set SKIP_VMP=1 to build without Spotify playback).'
    )
  }
}
