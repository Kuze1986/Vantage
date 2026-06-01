// creative/index.ts — shared canvas + export primitives used by all creative tools.
// Re-exports from socialkit/ (which owns the originals) plus the generic ExportCard
// and canvas furniture extracted here for use outside the Social Kit.

export { exportCanvasNode, EditableText, KitImageSlot, CopyButton } from '../pages/socialkit/primitives'
export { CanvasMark, Corners } from '../pages/socialkit/CanvasMark'
export type { BrandId } from '../pages/socialkit/brands'
export { BRANDS, BRAND_ORDER } from '../pages/socialkit/brands'
export type { Brand } from '../pages/socialkit/brands'

export { ExportCard } from './ExportCard'
export { CanvasBG, ScopeMark, CanvasCorners, CanvasWordmark, CanvasMetric, CTAPill, StatusBadge } from './canvasFurniture'
