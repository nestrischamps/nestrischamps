struct Region {
  src: vec4<f32>,
  dst: vec4<f32>,
  transformType: u32,
};

struct Globals {
  outputSize: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uvOutput: vec2<f32>, // This is passed to the fragment shader
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(1) @binding(0) var<uniform> region: Region;

@vertex
fn main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
  var positions = array<vec2<f32>, 6>(
    vec2(0.0, 0.0),
    vec2(1.0, 0.0),
    vec2(0.0, 1.0),
    vec2(0.0, 1.0),
    vec2(1.0, 0.0),
    vec2(1.0, 1.0)
  );

  let uv = positions[vertexIndex];
  let dstPos = region.dst.xy + uv * region.dst.zw;
  let ndc = (dstPos / globals.outputSize) * 2.0 - 1.0;

  var out: VertexOutput;
  out.position = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
  out.uvOutput = uv;
  return out;
}
