/**
 * leaflet-draw 1.0.4 on touch screens: one tap adds a vertex, then the browser's emulated
 * mouse/click events for that same tap land on the new vertex and count as "tap the last
 * point again", which finishes the line. The result is that a phone can only draw a
 * two-point dam. Ignore a finish that arrives right after a vertex added by touch; a
 * deliberate second tap (or the Finish button, which calls completeShape) still works.
 */
import L from 'leaflet'
import 'leaflet-draw'

const GHOST_MS = 600

const Poly = L.Draw?.Polyline?.prototype
if (Poly && !Poly._touchGhostFix) {
  const onTouch = Poly._onTouch
  const finishShape = Poly._finishShape

  Poly._onTouch = function (e) {
    const before = this._markers ? this._markers.length : 0
    onTouch.call(this, e)
    if ((this._markers ? this._markers.length : 0) > before) this._touchVertexAt = Date.now()
  }

  Poly._finishShape = function () {
    if (this._touchVertexAt && Date.now() - this._touchVertexAt < GHOST_MS) return
    return finishShape.call(this)
  }

  Poly._touchGhostFix = true
}
