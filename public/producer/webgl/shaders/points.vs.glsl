// points.vs.glsl
#version 300 es
layout(location=0) in vec2 aDstXY;   // pixel coords in final target
layout(location=1) in vec4 aSrcRect; // [u0, v0, uw, vh] normalized in atlas
uniform vec2 uTargetSize;            // final canvas size in pixels
out vec4 vSrcRect;
void main() {
  vec2 ndc = ((aDstXY + 0.5) / uTargetSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = 1.0;
  vSrcRect = aSrcRect;
}
