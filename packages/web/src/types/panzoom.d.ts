declare module 'panzoom' {
  export interface PanZoomController {
    moveTo: (x: number, y: number) => void;
    zoomAbs: (x: number, y: number, scale: number) => void;
    smoothZoom: (x: number, y: number, zoom: number) => void;
    dispose: () => void;
  }

  export interface PanZoomOptions {
    maxZoom?: number;
    minZoom?: number;
    smoothScroll?: boolean;
  }

  export default function panzoom(element: Element, options?: PanZoomOptions): PanZoomController;
}
