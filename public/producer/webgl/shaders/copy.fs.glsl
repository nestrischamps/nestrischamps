#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform int uMode; // 0=none, 1=luma, 2=red-luma
uniform float uBrightness;
uniform float uContrast;

// Constants baked into the shader:
const vec3 LUMA_COEFF = vec3(0.299, 0.587, 0.114);
const float RED_LOW  = 0.08;
const float RED_HIGH = 0.55;

in vec2 vUV;
out vec4 fragColor;

void main() {
  vec4 c = texture(uTex, vUV);

  c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
  c.rgb *= uBrightness;

  if (uMode == 1) {
    float y = dot(c.rgb, LUMA_COEFF);
    c = vec4(vec3(y), c.a);
  } else if (uMode == 2) {
    float r = clamp((c.r - RED_LOW) / (RED_HIGH - RED_LOW), 0.0, 1.0);
    c = vec4(vec3(r), c.a);
  }

  fragColor = c;
}