// React 19 + Radix Portal + iOS Safari (and Chrome with translation extensions)
// occasionally throw "NotFoundError: The object can not be found here." during
// portal cleanup: a node was moved or already detached by the browser before
// React's commit phase tried to removeChild it. React treats this as a fatal
// error and unmounts the whole tree (= white screen).
//
// The workaround that several React 19 + Radix apps ship is to make the two
// DOM mutation primitives tolerant when the parent/child relationship has
// already drifted. This silences only the spurious error — legitimate calls
// still go through.
//
// References:
//   https://github.com/facebook/react/issues/11538
//   https://github.com/radix-ui/primitives/issues/1485

export function installDomPatches(): void {
  if (typeof Node === "undefined") return

  const originalRemoveChild = Node.prototype.removeChild
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      // The child has been moved/removed out from under React. Pretend it
      // succeeded so React's commit phase doesn't throw.
      return child
    }
    return originalRemoveChild.call(this, child) as T
  }

  const originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function <T extends Node>(
    this: Node,
    newNode: T,
    referenceNode: Node | null,
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      // The reference node moved; fall back to appending so React doesn't
      // throw. This loses precise ordering only in pathological cases.
      return originalInsertBefore.call(this, newNode, null) as T
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T
  }
}
