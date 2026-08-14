// Prints the CGWindowID of the frontmost normal-layer window owned by the
// given app (default: Ghostty). Used by capture-window.sh so the broadcast
// follows ONE window — not the screen.
import CoreGraphics
import Foundation

let appName = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Ghostty"

func firstWindow(_ opts: CGWindowListOption) -> (Int, String)? {
  // onScreenOnly returns windows front-to-back, so the first match is the
  // frontmost window of the app — the one the broadcaster is working in.
  guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
    return nil
  }
  for w in list {
    guard let owner = w[kCGWindowOwnerName as String] as? String, owner == appName,
          let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
          let id = w[kCGWindowNumber as String] as? Int
    else { continue }
    let title = (w[kCGWindowName as String] as? String) ?? ""
    return (id, title)
  }
  return nil
}

if let (id, title) = firstWindow([.optionOnScreenOnly, .excludeDesktopElements])
  ?? firstWindow([.optionAll, .excludeDesktopElements]) {
  print(id)
  print(title)
} else {
  FileHandle.standardError.write("no \(appName) window found\n".data(using: .utf8)!)
  exit(1)
}
