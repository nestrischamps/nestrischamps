// points.fs.glsl
#version 300 es
precision highp float;
uniform sampler2D uAtlas;
uniform int uNumOffsets;
uniform vec2 uOffsets[16];
uniform float uShineThreshold;
in vec4 vSrcRect;
out vec4 fragColor;

vec3 sampleAt(vec2 o) {
  vec2 uv = vSrcRect.xy + o * vSrcRect.zw;
  return texture(uAtlas, uv).rgb;
}

void main() {
  int n = max(uNumOffsets, 1);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 16; ++i) {
    if (i >= n) break;
    sum += sampleAt(uOffsets[i]);
  }
  vec3 avg = sum / float(n);
  float luma = dot(avg, vec3(0.2126, 0.7152, 0.0722));
  float alpha = luma > uShineThreshold ? 1.0 : 0.0;
  fragColor = vec4(avg, alpha);
}
