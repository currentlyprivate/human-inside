// Prints the CGWindowID of the frontmost normal-layer window owned by the
// given app (default: Ghostty). Used by capture-window.sh so the broadcast
// follows ONE window — not the screen.
//
// SAFETY SCOPING: when a tag is given (arg 2, or BROADCAST_TAG), only windows
// whose TITLE contains that tag are eligible. This designates one broadcast
// window: private Ghostty windows (secret projects, the Human Inside launch
// itself) stay off air even when frontmost, because they aren't tagged.
// Crucially there is NO fall-back to "frontmost untagged window" — if nothing
// matches the tag we exit non-zero, and the capture loop FREEZES the feed (and
// warns) rather than showing something private. Fail closed, always.
import CoreGraphics
import Foundation

let appName = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Ghostty"
// Empty tag = no filter (legacy behaviour: follow the frontmost app window).
let tag = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : ""

func firstWindow(_ opts: CGWindowListOption) -> (Int, String)? {
  // onScreenOnly returns windows front-to-back, so the first match is the
  // frontmost eligible window of the app — the one the broadcaster is working in.
  guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
    return nil
  }
  for w in list {
    guard let owner = w[kCGWindowOwnerName as String] as? String, owner == appName,
          let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
          let id = w[kCGWindowNumber as String] as? Int
    else { continue }
    let title = (w[kCGWindowName as String] as? String) ?? ""
    // Tag filter: only a window whose title carries the tag is on air.
    if !tag.isEmpty && !title.contains(tag) { continue }
    return (id, title)
  }
  return nil
}

// When a tag is set we do NOT fall back to .optionAll — a tagged broadcast must
// only ever match an on-screen, tagged window. No match → exit 1 → feed freezes.
let fallback = tag.isEmpty ? firstWindow([.optionAll, .excludeDesktopElements]) : nil
if let (id, title) = firstWindow([.optionOnScreenOnly, .excludeDesktopElements]) ?? fallback {
  print(id)
  print(title)
} else {
  let why = tag.isEmpty ? "no \(appName) window found" : "no \(appName) window titled with tag \"\(tag)\""
  FileHandle.standardError.write("\(why)\n".data(using: .utf8)!)
  exit(1)
}
