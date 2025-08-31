#version 300 es
precision highp float;

uniform int uNumTotalJobs;         // total N (also width)
layout(location=0) in float aIndex;
flat out int vIndex;

void main() {
  vIndex = int(aIndex);

  // one row of N pixels; map index to pixel center
  float x = (aIndex + 0.5) / float(uNumTotalJobs) * 2.0 - 1.0;
  gl_Position = vec4(x, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
