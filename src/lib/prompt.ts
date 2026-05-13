const subjects = [
  "a confident fashion model walking through a quiet city street",
  "a cozy product lifestyle scene on a clean studio table",
  "a cinematic portrait with natural skin texture and realistic light",
  "a premium e-commerce product photo on a seamless white backdrop",
  "a candid daily-life snapshot captured on a modern smartphone",
];

const lighting = [
  "soft daylight from a large side window",
  "clean commercial studio lighting with realistic shadows",
  "warm late-afternoon light with subtle film grain",
  "high-end editorial lighting, crisp but natural",
  "raw smartphone flash with honest imperfections",
];

const cameras = [
  "50mm full-frame camera, shallow depth of field",
  "smartphone back camera, unfiltered, natural perspective",
  "editorial magazine composition, balanced negative space",
  "product photography lens, sharp fabric and surface detail",
];

export function randomPrompt() {
  return [
    `[Subject]: ${pick(subjects)}`,
    "[Style]: photorealistic, believable, no plastic AI texture",
    `[Lighting]: ${pick(lighting)}`,
    `[Camera]: ${pick(cameras)}`,
    "[Output]: high detail, coherent hands and textures, production-ready image",
  ].join("\n");
}

export function buildReferenceInstruction(prompt: string, referenceCount: number) {
  if (referenceCount === 0) return prompt;
  return [
    "Use the attached reference images carefully.",
    "Preserve identity only from face references, clothing only from outfit references, and environment/vibe only from style references.",
    "Make the final image realistic, naturally lit, and visually consistent.",
    "",
    prompt,
  ].join("\n");
}

function pick<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}
