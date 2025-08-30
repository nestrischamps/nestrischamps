#version 300 es
precision highp float;

uniform sampler2D uAtlas;

// Sampling pattern (normalized 0..1 inside aSrcPx)
uniform int  uNumOffsets;       // <= 16
uniform vec2 uOffsets[16];      // e.g., 0.5/center, plus a cross, etc.
uniform float uShineThreshold;  // luma threshold

// Mode controls how to pack outputs, if you want to draw all in one pass.
// 0 = just average color, alpha=1
// 1 = luma-only pixel (R=G=B=luma), alpha = luma > threshold ? 1 : 0
// 2 = average color, alpha = shine predicate
uniform int uMode;

in vec4 vSrcUV;                 // [u0,v0,uw,vh]
out vec4 fragColor;

float luma(vec3 c) {
  // Rec.601 to match your WGSL: 0.299, 0.587, 0.114
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  int n = max(uNumOffsets, 1);
  vec3 sum = vec3(0.0);

  for (int i = 0; i < 16; ++i) {
    if (i >= n) break;
    vec2 uv = vSrcUV.xy + uOffsets[i] * vSrcUV.zw;
    sum += texture(uAtlas, uv).rgb;
  }

  vec3 avg = sum / float(n);
  float y = luma(avg);
  float shine = y > uShineThreshold ? 1.0 : 0.0;

  if (uMode == 1) {
    fragColor = vec4(vec3(y), shine);      // shine in alpha
  } else if (uMode == 2) {
    fragColor = vec4(avg, shine);          // color avg, shine in alpha
  } else {
    fragColor = vec4(avg, 1.0);            // plain average
  }
}
