// Define constants for clarity, matching your JS
const TRANSFORM_NONE = 0u; // Use 'u' suffix for unsigned integer literal
const TRANSFORM_LUMA = 1u;
const TRANSFORM_RED_LUMA = 2u;

struct Region {
  src: vec4<f32>,  // x, y, w, h
  dst: vec4<f32>,  // x, y, w, h
  transformType: f32,
};

struct Globals {
  outputSize: vec2<f32>,
  inputSize: vec2<f32>,
  brightness: f32,
  contrast: f32,
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var inputSampler: sampler;
@group(0) @binding(2) var inputTexture: texture_external;

@group(1) @binding(0) var<uniform> region: Region;

@fragment
fn main(@location(0) uvOutput: vec2<f32>) -> @location(0) vec4<f32> {
  // Convert uvOutput [0,1] → actual srcPos → uv in input texture
  let srcPos = region.src.xy + uvOutput * region.src.zw;
  let uvInput = srcPos / globals.inputSize;

  // Optional safety clamp (if rounding ever causes overflow)
  let uvClamped = clamp(uvInput, vec2<f32>(0.0), vec2<f32>(1.0));

  var color = textureSampleBaseClampToEdge(inputTexture, inputSampler, uvClamped);


  // Apply contrast first: pivot around 0.5
  let contrast_rgb = (color.rgb - vec3<f32>(0.5)) * vec3<f32>(globals.contrast) + vec3<f32>(0.5);
  color = vec4<f32>(contrast_rgb, color.a);

  // Then apply brightness
  let brightness_rgb = color.rgb * vec3<f32>(globals.brightness);
  color = vec4<f32>(brightness_rgb, color.a);

  // Clamp the color to ensure it stays in the [0, 1] range after adjustments
  color = clamp(color, vec4<f32>(0.0), vec4<f32>(1.0));

  let transformType = u32(region.transformType);

  // Apply transform based on uniform
  if (transformType == TRANSFORM_LUMA) {
    let r = color.r;
    let g = color.g;
    let b = color.b;

    // Apply luma formula: r * 0.299 + g * 0.587 + b * 0.114
    let luma_value = r * 0.299 + g * 0.587 + b * 0.114;

    // Set all color components to the luma value, keeping original alpha
    color = vec4<f32>(luma_value, luma_value, luma_value, color.a);
  }
  else if (transformType == TRANSFORM_RED_LUMA) {
    let constrastHigh = 0.65;
    let constrastLow = 0.08;
    let r = clamp((color.r - constrastLow) / (constrastHigh - constrastLow), 0.0, 1.0);

    color = vec4<f32>(r, r, r, color.a);
  }

  return color;
}
