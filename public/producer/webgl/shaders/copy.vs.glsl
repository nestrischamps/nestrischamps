#version 300 es
precision highp float;

// Texture size, and output framebuffer size, in pixels
uniform ivec2 uTexSize;     // e.g. ivec2(videoWidth, videoHeight)
uniform ivec2 uOutSize;     // e.g. ivec2(canvas.width, canvas.height)

uniform bool uFlipY;

// Rectangles in pixels, top-left origin: [x, y, w, h]
uniform ivec4 uSrcPx;
uniform ivec4 uDstPx;

out vec2 vUV;

const vec2 positions[6] = vec2[6](
  vec2(0.0, 0.0),
  vec2(1.0, 0.0),
  vec2(0.0, 1.0),
  vec2(0.0, 1.0),
  vec2(1.0, 0.0),
  vec2(1.0, 1.0)
);

void main() {
  vec2 uv01 = positions[gl_VertexID];

  // Place the quad in output pixels (top-left), then to NDC, then flip framebuffer Y
  vec2 dstPos = vec2(uDstPx.xy) + uv01 * vec2(uDstPx.zw);       // cast ivec2 -> vec2
  vec2 ndc    = (dstPos / vec2(uOutSize)) * 2.0 - 1.0;          // cast ivec2 -> vec2
  if (uFlipY) ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);

  // Build source UVs from pixel rect with top-left origin, convert to bottom-left UV
  vec2 u0v0_px = vec2(uSrcPx.xy);                                // ivec2 -> vec2

  vec2 texSize = vec2(uTexSize);                                 // ivec2 -> vec2
  vec2 u0v0    = vec2(u0v0_px.x / texSize.x,
                      u0v0_px.y / texSize.y);
  vec2 uvSize  = vec2(float(uSrcPx.z) / texSize.x,
                      float(uSrcPx.w) / texSize.y);              // int -> float

  vUV = u0v0 + uv01 * uvSize;
}