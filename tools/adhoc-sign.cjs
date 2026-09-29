// electron-builder afterPack 훅. 묶은 askin.app 전체를 ad-hoc 으로 다시 서명한다.
// dmg·zip 은 이 훅 뒤에 만들어지므로 배포 파일에는 서명된 앱이 들어간다.
//
// 왜: 서명을 건너뛰면(identity: null) Electron 원본의 linker-signed 서명만 남는데, askin 파일이
// 더해진 번들과 안 맞는다. 인터넷에서 받은 앱에서는 macOS 가 "손상되어서 열 수 없다"고 하고
// "그래도 열기"도 안 준다(실측 2026-09-29, v0.2.0). electron-builder 25 는 identity: '-' 를
// ad-hoc 으로 받지 않고 키체인에서 찾다 건너뛴다(실측) — 그래서 여기서 codesign 을 직접 부른다.
// 노터라이즈는 안 한다. ad-hoc 서명된 앱은 처음 열 때 "그래도 열기"로 허용할 수 있다.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' })
  // 봉인이 맞는지 여기서 바로 확인한다. 틀리면 빌드를 멈춘다.
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
