const subjects = [
  "a confident fashion model walking through a quiet neon-lit Tokyo street at blue hour",
  "a luxury product lifestyle scene on a sculpted dark slate podium with water ripples",
  "a cinematic editorial portrait with natural skin texture and dramatic rim lighting",
  "a high-fashion e-commerce lookbook photo on a seamless studio backdrop",
  "a futuristic streetwear campaign shot with prism light reflections",
];

const lighting = [
  "soft daylight from a large side window with gentle fill",
  "clean commercial studio lighting with realistic floor shadows",
  "electric blue and warm amber dual-tone cinematic key light",
  "high-end editorial butterfly lighting, crisp fabric detail",
  "natural golden hour rim light with subtle film grain",
];

const cameras = [
  "50mm full-frame prime lens, f/1.8 shallow depth of field",
  "85mm editorial portrait lens, balanced negative space",
  "medium-format studio camera, ultra-sharp fabric and skin micro-texture",
  "35mm dynamic low-angle fashion perspective",
];

export function randomPrompt() {
  return [
    `[Subject]: ${pick(subjects)}`,
    "[Style]: photorealistic, high-fashion editorial, natural textures",
    `[Lighting]: ${pick(lighting)}`,
    `[Camera]: ${pick(cameras)}`,
    "[Output]: 4K studio quality, coherent hands and garment stitching, production-ready",
  ].join("\n");
}

export function buildReferenceInstruction(prompt: string, referenceCount: number) {
  if (referenceCount === 0) return prompt;
  return [
    "Use the attached reference images carefully.",
    "When a face reference is attached, use it for facial appearance. Use clothing and footwear only from outfit references. Use environment/vibe only from style references.",
    "Make the final image realistic, naturally lit, and visually consistent.",
    "",
    prompt,
  ].join("\n");
}

function pick<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}
