/** Shared image and stage illumination; encoded-sRGB PMA enters and leaves exactly once. */
export const lightingGlsl = `
uniform vec3 uBase;
uniform vec3 uPoint;
uniform vec2 uLight;
uniform float uRadius;
uniform float uSoftness;
uniform mat3 uLocalToScene;
vec3 decodeSrgb(vec3 c) {
 return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));
}
vec3 encodeSrgb(vec3 c) {
 return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));
}
vec4 illuminate(vec4 pma,vec2 local) {
 if(pma.a<=0.0)return vec4(0.0);
 vec2 xy=(uLocalToScene*vec3(local,1.0)).xy;
 float d=distance(xy,uLight);
 float f=uSoftness==0.0?(d<uRadius?1.0:0.0):1.0-smoothstep(uRadius*(1.0-uSoftness),uRadius,d);
 vec3 gain=max(vec3(0.0),uBase+uPoint*f);
 vec3 outLinear=clamp(decodeSrgb(pma.rgb/pma.a)*gain,0.0,1.0);
 return vec4(encodeSrgb(outLinear)*pma.a,pma.a);
}`;
export const filterVertex = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
 vec2 p=aPosition*uOutputFrame.zw+uOutputFrame.xy;
 p.x=p.x*2.0/uOutputTexture.x-1.0;
 p.y=p.y*2.0*uOutputTexture.z/uOutputTexture.y-uOutputTexture.z;
 gl_Position=vec4(p,0.0,1.0);
 vTextureCoord=aPosition*uOutputFrame.zw*uInputSize.zw;
}`;
