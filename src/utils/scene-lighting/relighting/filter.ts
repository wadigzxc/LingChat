import { Filter, GlProgram, ImageSource, Texture, UniformGroup } from "pixi.js";
import type { FilterSystem, RenderSurface } from "pixi.js";
import type { ShaderSpec, ImageVisualFrame, RasterFrame } from "./types";
import { lightingGlsl, filterVertex } from "./glsl";
export type RelightingInput =
  | { kind: "image-stack"; frame: ImageVisualFrame }
  | { kind: "pixi-stage-pma" };
const imageGlsl = `
uniform sampler2D uImage0;
uniform sampler2D uImage1;
uniform float uCount;
uniform vec2 uSize0;
uniform vec2 uSize1;
uniform vec4 uDraw0;
uniform vec4 uDraw1;
uniform vec4 uClip0;
uniform vec4 uClip1;
uniform mat3 uTexel0;
uniform mat3 uTexel1;
uniform float uOpacity0;
uniform float uOpacity1;
vec4 texelPma(sampler2D image,vec2 size,vec2 ij){
 vec4 c=texture(image,(clamp(ij,vec2(0.0),size-1.0)+0.5)/size);
 return vec4(c.rgb*c.a,c.a);
}
vec4 virtualPma(sampler2D image,vec2 size,vec2 ij,float block){
 vec2 virtualSize=ceil(size/block);
 vec2 start=clamp(ij,vec2(0.0),virtualSize-1.0)*block;
 vec4 p=vec4(0.0);
 for(int y=0;y<4;y++)for(int x=0;x<4;x++){
  if(float(x)<block&&float(y)<block)p+=texelPma(image,size,start+vec2(float(x),float(y)));
 }
 return p/(block*block);
}
vec4 sampleLayer(sampler2D image,vec2 size,vec4 draw,vec4 clip,mat3 toTexel,float opacity,vec2 local){
 if(opacity<=0.0||any(lessThan(local,draw.xy))||any(greaterThanEqual(local,draw.xy+draw.zw))||
 any(lessThan(local,clip.xy))||any(greaterThanEqual(local,clip.xy+clip.zw)))return vec4(0.0);
 // The map's derivatives include crop extent and source mirror; scene geometry is independent.
 float shrink=min(abs(toTexel[0][0]),abs(toTexel[1][1]))/uResolution;
 float block=shrink<4.0?1.0:(shrink<8.0?2.0:4.0);
 vec2 texel=(toTexel*vec3(local,1.0)).xy/block-0.5;
 vec2 ij=floor(texel),w=fract(texel);
 vec4 p=mix(mix(virtualPma(image,size,ij,block),virtualPma(image,size,ij+vec2(1,0),block),w.x),
 mix(virtualPma(image,size,ij+vec2(0,1),block),virtualPma(image,size,ij+vec2(1,1),block),w.x),w.y);
 return p*opacity;
}
vec4 imageStack(vec2 local){
 vec4 p=vec4(0.0);
 if(uCount>0.0)p=sampleLayer(uImage0,uSize0,uDraw0,uClip0,uTexel0,uOpacity0,local);
 if(uCount>1.0&&uOpacity1>0.0){vec4 top=sampleLayer(uImage1,uSize1,uDraw1,uClip1,uTexel1,uOpacity1,local);p=top+p*(1.0-top.a);}
 return p;
}`;
function matrix([a, b, c, d, e, f]: readonly number[]) {
  return new Float32Array([a, b, 0, c, d, 0, e, f, 1]);
}
function uniforms(spec: ShaderSpec, raster: RasterFrame) {
  return new UniformGroup({
    uBase: { value: new Float32Array(spec.baseSignedLinear), type: "vec3<f32>" },
    uPoint: { value: new Float32Array(spec.pointLinear), type: "vec3<f32>" },
    uLight: { value: new Float32Array(spec.lightSceneCss), type: "vec2<f32>" },
    uRadius: { value: spec.radiusSceneCss, type: "f32" },
    uSoftness: { value: spec.softness, type: "f32" },
    uLocalToScene: { value: matrix(spec.localToScene), type: "mat3x3<f32>" },
    uOrigin: { value: new Float32Array(raster.originLocalCss), type: "vec2<f32>" },
    uViewport: { value: new Float32Array(raster.outputViewportPx.slice(0, 2)), type: "vec2<f32>" },
    uResolution: { value: raster.actualResolution, type: "f32" },
  });
}
function imageUniforms() {
  return new UniformGroup({
    uCount: { value: 0, type: "f32" },
    ...Object.fromEntries(
      [0, 1].flatMap((i) => [
        ["uSize" + i, { value: new Float32Array([1, 1]), type: "vec2<f32>" }],
        ["uDraw" + i, { value: new Float32Array(4), type: "vec4<f32>" }],
        ["uClip" + i, { value: new Float32Array(4), type: "vec4<f32>" }],
        ["uTexel" + i, { value: matrix([1, 0, 0, 1, 0, 0]), type: "mat3x3<f32>" }],
        ["uOpacity" + i, { value: 0, type: "f32" }],
      ])
    ),
  });
}
export class RelightingFilter extends Filter {
  private sources = new Map<HTMLImageElement, { revision: number; source: ImageSource }>();
  private ownedDisposed = false;
  private imageInput: boolean;
  private requestToken = -1;
  private frameRevision = -1;
  readonly lighting: ReturnType<typeof uniforms>;
  readonly images: UniformGroup;
  constructor(spec: ShaderSpec, input: RelightingInput, raster: RasterFrame) {
    const lighting = uniforms(spec, raster),
      images = imageUniforms(),
      imageInput = input.kind === "image-stack";
    super({
      glProgram: GlProgram.from({
        vertex: filterVertex,
        fragment: `precision highp float;
 in vec2 vTextureCoord;
 uniform sampler2D uTexture;
 uniform vec4 uInputSize;
 uniform vec2 uOrigin;
 uniform vec2 uViewport;
 uniform float uResolution;
 uniform vec4 uOutputFrame;
 uniform vec4 uOutputTexture;
 out vec4 finalColor;
 ${lightingGlsl}
 ${imageInput ? imageGlsl : ""}
 void main(){vec2 pixel=(gl_FragCoord.xy-uViewport)/uResolution;
 if(uOutputTexture.z<0.0)pixel.y=uOutputTexture.y-pixel.y;
 vec2 local=uOrigin+pixel-uOutputFrame.xy;
 finalColor=illuminate(${imageInput ? "imageStack(local)" : "texture(uTexture,vTextureCoord)"},local);}`,
      }),
      padding: 0,
      resolution: "inherit",
      resources: {
        lightingUniforms: lighting,
        ...(imageInput
          ? {
              imageUniforms: images,
              uImage0: Texture.EMPTY.source,
              uImage0Sampler: Texture.EMPTY.source.style,
              uImage1: Texture.EMPTY.source,
              uImage1Sampler: Texture.EMPTY.source.style,
            }
          : {}),
      },
    });
    this.lighting = lighting;
    this.images = images;
    this.imageInput = imageInput;
    if (input.kind === "image-stack") this.setFrame(input.frame);
  }
  lastRaster: RasterFrame | null = null;
  override apply(manager: FilterSystem, input: Texture, output: RenderSurface, clear: boolean) {
    // Narrow, version-pinned Pixi8 pass metadata. Unknown state must fail instead of guessing full root.
    const data = (
      manager as unknown as { _activeFilterData?: { bounds: { minX: number; minY: number } } }
    )._activeFilterData;
    const target = manager.renderer.renderTarget.getRenderTarget(output);
    const resolution = target.resolution;
    const rect =
      output instanceof Texture
        ? output.frame
        : { x: 0, y: 0, width: target.width, height: target.height };
    const viewport = [
      rect.x * resolution,
      target.isRoot
        ? target.pixelHeight - (rect.y + rect.height) * resolution
        : rect.y * resolution,
      rect.width * resolution,
      rect.height * resolution,
    ] as const;
    if (
      !data ||
      ![data.bounds.minX, data.bounds.minY, resolution, ...viewport].every(Number.isFinite) ||
      resolution <= 0
    )
      throw new Error("source-unavailable: invalid raster pass");
    this.lastRaster = {
      originLocalCss: [data.bounds.minX, data.bounds.minY],
      extentLocalCss: [input.frame.width, input.frame.height],
      actualResolution: resolution,
      inputFramePx: [
        input.frame.x * input.source.resolution,
        input.frame.y * input.source.resolution,
        input.frame.width * input.source.resolution,
        input.frame.height * input.source.resolution,
      ],
      outputViewportPx: viewport,
      rootOutput: target.isRoot,
    };
    this.lighting.uniforms.uOrigin.set(this.lastRaster.originLocalCss);
    this.lighting.uniforms.uViewport.set(viewport.slice(0, 2));
    this.lighting.uniforms.uResolution = resolution;
    this.lighting.update();
    manager.applyFilter(this, input, output, clear);
  }
  setSpec(spec: ShaderSpec) {
    const u = this.lighting.uniforms;
    u.uBase.set(spec.baseSignedLinear);
    u.uPoint.set(spec.pointLinear);
    u.uLight.set(spec.lightSceneCss);
    u.uRadius = spec.radiusSceneCss;
    u.uSoftness = spec.softness;
    u.uLocalToScene.set(matrix(spec.localToScene));
    this.lighting.update();
  }
  setFrame(frame: ImageVisualFrame) {
    if (this.ownedDisposed || !this.imageInput) return;
    if (
      frame.requestToken < this.requestToken ||
      (frame.requestToken === this.requestToken && frame.revision < this.frameRevision)
    )
      return;
    if (frame.layers.length > 2) throw new Error("source-unavailable: more than two image layers");
    this.requestToken = frame.requestToken;
    this.frameRevision = frame.revision;
    const used = new Set<HTMLImageElement>();
    const u = this.images.uniforms as Record<string, number | Float32Array>;
    u.uCount = frame.layers.length;
    const set = (name: string, values: ArrayLike<number>) => {
      (u[name] as Float32Array).set(values);
    };
    frame.layers.forEach((layer, i) => {
      const image = layer.source.resource;
      used.add(image);
      let cached = this.sources.get(image);
      if (!cached || cached.revision !== layer.source.revision) {
        cached?.source.destroy();
        cached = {
          revision: layer.source.revision,
          source: new ImageSource({
            resource: image,
            width: layer.source.naturalSizePx[0],
            height: layer.source.naturalSizePx[1],
            resolution: 1,
            alphaMode: "no-premultiply-alpha",
            format: "rgba8unorm",
            scaleMode: "nearest",
            autoGenerateMipmaps: false,
          }),
        };
        this.sources.set(image, cached);
      }
      this.resources["uImage" + i] = cached.source;
      this.resources["uImage" + i + "Sampler"] = cached.source.style;
      set("uSize" + i, layer.source.naturalSizePx);
      set("uDraw" + i, layer.drawRectCss);
      set("uClip" + i, layer.clipRectCss);
      set("uTexel" + i, matrix(layer.localToTexel));
      u["uOpacity" + i] = layer.opacity;
    });
    for (let i = frame.layers.length; i < 2; i++) {
      this.resources["uImage" + i] = Texture.EMPTY.source;
      this.resources["uImage" + i + "Sampler"] = Texture.EMPTY.source.style;
      u["uOpacity" + i] = 0;
    }
    for (const [image, cached] of this.sources)
      if (!used.has(image)) {
        cached.source.destroy();
        this.sources.delete(image);
      }
    this.images.update();
  }
  override destroy(_destroyPrograms = false) {
    if (this.ownedDisposed) return;
    this.ownedDisposed = true;
    for (const c of this.sources.values()) c.source.destroy();
    this.sources.clear();
    // GlProgram.from is global immutable shader cache, not this surface's owned GPU handles.
    super.destroy(false);
  }
}
export function createRelightingFilter(
  spec: ShaderSpec,
  input: RelightingInput,
  raster: RasterFrame
): RelightingFilter {
  return new RelightingFilter(spec, input, raster);
}
