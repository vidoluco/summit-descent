// Which GPU draws the game. A Mac that falls back to software WebGL (SwiftShader, after a GPU crash or with
// hardware acceleration off) runs the game at under 1 fps, so the TV page says so instead of just crawling.

// The WebGL renderer string, unmasked where the browser allows it.
export function rendererName(gl) {
  if (!gl?.getParameter) return '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch {
    return '';
  }
}

// SwiftShader (Chrome), llvmpipe and softpipe (Mesa), Microsoft Basic Render: the CPU rasterises every pixel.
export function isSoftwareRenderer(name) {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name || '');
}
