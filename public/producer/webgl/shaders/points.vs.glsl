#version 300 es
precision highp float;

// Source atlas size, final target size
uniform ivec2 uAtlasSize;  // e.g. ivec2(ATLAS_W, ATLAS_H)
uniform ivec2 uFinalSize;  // e.g. ivec2(FINAL_W, FINAL_H)

// Per-vertex data
layout(location=0) in vec2 aDstXY;   // destination pixel (x,y) in final
layout(location=1) in vec2 aSrcPx;   // source top-left in atlas pixels

// Toggle if your atlas upload was already flipped (usually 0)
uniform int uSampleFlipY;

out vec4 vSrcUV; // [u0,v0,uw,vh] bottom-left UVs for the atlas

void main() {
  // Place a single pixel in final
  vec2 ndc = ((aDstXY + vec2(0.5)) / vec2(uFinalSize)) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  gl_PointSize = 1.0;

  // Convert top-left pixels to bottom-left UVs
  vec2 texSize = vec2(uAtlasSize);
  vec2 tl = aSrcPx.xy;
  vec2 br = aSrcPx.xy + aSrcPx.zw;

  float u0 = tl.x / texSize.x;
  float v0 = 1.0 - br.y / texSize.y;      // bottom-left v
  float uw = aSrcPx.z / texSize.x;
  float vh = aSrcPx.w / texSize.y;

  if (uSampleFlipY == 1) {
    // undo any prior UNPACK_FLIP on the atlas
    v0 = 1.0 - (tl.y / texSize.y) - vh;
  }

  vSrcUV = vec4(u0, v0, uw, vh);
}
