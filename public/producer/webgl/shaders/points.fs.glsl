#version 300 es
precision highp float;

uniform sampler2D uAtlas;
uniform ivec2 uAtlasSize;      // atlas size in pixels

// Which set of offsets to use, and how to pack the output
// 0 = plain average color, alpha=1
// 1 = luma-only in RGB, alpha = shine (thresholded)
// 2 = average color, alpha = shine
uniform int uKind;
uniform float uShineThreshold;

flat in ivec2 vSrcTL;          // source top-left pixel in atlas
out vec4 fragColor;

// ===== Your baked constants =====
const ivec2 GYM_PAUSE_CROP_RELATIVE_TO_FIELD = ivec2(37, 47);
const int   NUM_BOARD_BLOCKS = 200;
const int   NUM_REF_COLORS   = 3;
const int   MAX_SHINE_SPOTS  = 14 + 20;

const ivec2 boardColorOffsets[4] = ivec2[4](
  ivec2(2,4),
  ivec2(3,3),
  ivec2(4,4),
  ivec2(4,2)
);
const ivec2 boardShineOffsets[3] = ivec2[3](
  ivec2(1,1),
  ivec2(1,2),
  ivec2(2,1)
);
const ivec2 refColorOffsets[3] = ivec2[3](
  ivec2(3,2),
  ivec2(3,3),
  ivec2(2,3)
);
const ivec2 pieceBlockShineOffsets[3] = ivec2[3](
  ivec2(0,0),
  ivec2(1,1),
  ivec2(1,2)
);
const ivec2 gymPauseOffsets[4] = ivec2[4](
  ivec2(GYM_PAUSE_CROP_RELATIVE_TO_FIELD.x +  2, GYM_PAUSE_CROP_RELATIVE_TO_FIELD.y),
  ivec2(GYM_PAUSE_CROP_RELATIVE_TO_FIELD.x + 10, GYM_PAUSE_CROP_RELATIVE_TO_FIELD.y),
  ivec2(GYM_PAUSE_CROP_RELATIVE_TO_FIELD.x + 17, GYM_PAUSE_CROP_RELATIVE_TO_FIELD.y),
  ivec2(GYM_PAUSE_CROP_RELATIVE_TO_FIELD.x + 18, GYM_PAUSE_CROP_RELATIVE_TO_FIELD.y)
);

// ===== helpers =====

// Convert a pixel coordinate (pxX, pxY) in atlas top-left space
// to bottom-left UV at the texel center.
vec2 uv_at_pixel(ivec2 px) {
  vec2 sz = vec2(uAtlasSize);
  // +0.5 to sample the texel center, y flipped to bottom-left UV
  return vec2((float(px.x) + 0.5) / sz.x,
              1.0 - (float(px.y) + 0.5) / sz.y);
}

float luma601(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Average N samples at offsets from top-left
vec3 avg_at_offsets(const ivec2 offs[], int N) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < N; ++i) {
    ivec2 p = vSrcTL + offs[i];
    sum += texture(uAtlas, uv_at_pixel(p)).rgb;
  }
  return sum / float(N);
}

void main() {
  vec3 avg = vec3(0.0);
  float shine = 0.0;

  if (uKind == 0) {
    // plain average using boardColorOffsets as an example
    avg = avg_at_offsets(boardColorOffsets, 4);
    fragColor = vec4(avg, 1.0);
    return;
  }

  if (uKind == 1) {
    // luma-only, shine from boardShineOffsets
    avg = avg_at_offsets(boardColorOffsets, 4);
    float y = luma601(avg);
    float ySh = luma601(avg_at_offsets(boardShineOffsets, 3));
    shine = ySh > uShineThreshold ? 1.0 : 0.0;
    fragColor = vec4(vec3(y), shine);
    return;
  }

  if (uKind == 2) {
    // color average from boardColorOffsets, alpha = shine from boardShineOffsets
    avg = avg_at_offsets(boardColorOffsets, 4);
    float ySh = luma601(avg_at_offsets(boardShineOffsets, 3));
    shine = ySh > uShineThreshold ? 1.0 : 0.0;
    fragColor = vec4(avg, shine);
    return;
  }

  // You can add more modes:
  // - refs using refColorOffsets
  // - piece shines using pieceBlockShineOffsets
  // - gym pause using gymPauseOffsets (absolute anchor math)
}
