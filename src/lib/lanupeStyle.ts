// Lanupe_ style profile for AI / detailed prompt suggestions.
//
// Source: the user's own @lanupe_ Instagram profile, surveyed 2026-11-05:
// 50 distinct posts (49 photo posts, mostly multi-frame sets for one
// outfit, and 1 reel viewed by its main frame). The 6th group found
// there — product-only close-ups with no model — was deliberately
// DROPPED by the user, so only the 5 model directions below remain.
//
// This file is a style profile, not copied captions or photos: it
// describes observable directions (palette, light, framing, pose,
// wardrobe, setting) so prompts can be varied inside the same look.
// Nothing here copies a real person's identity or likeness.

export type LanupeDirectionId =
  | "autumnStreet"
  | "mirrorSelfie"
  | "studioLookbook"
  | "blackEvening"
  | "summerBright";

export interface LanupeDirection {
  id: LanupeDirectionId;
  label: string;
  share: string;
  palette: string;
  mood: string;
  colorTone: string;
  lighting: string;
  outfits: string[];
  backgrounds: string[];
  poses: string[];
  angles: string[];
  notes: string;
}

// The studio muse used when NO face reference is attached.
//
// Why this exists: the old builder only said "a pretty face, natural
// balanced features" with no age and no face at all, so the image
// model defaulted to a generic, visibly older average face — the
// "bà già xấu" look the user complained about. A vague beauty word
// does not beat a model's default; a concrete young face does.
//
// FACE SYSTEM — observed, not guessed.
//
// Source (2026-11-05 01:48-01:51): a logged-in Instagram session
// opened @lanupe_ and inspected 26 top-grid posts, 20 with a face
// clear enough to compare. The face below is what actually repeats
// in those 20: same soft oval V-line, small pointed chin, small
// straight nose, dark-brown almond eyes, small mouth with a fuller
// lower lip, very bright skin. Hair changes a lot (that is why hair
// is a VARIANT list, while the face core stays fixed) — the system
// is: one fixed face + rotating hair, not a new face per prompt.
//
// Two earlier guesses are DELETED here and must not come back:
// (1) "24 to 28 years old" — a guessed number the user called too
// old; youth is now conveyed only by observed youthful cues
// (slightly full cheeks, very bright smooth skin, dewy glow),
// with no numeric age at all, and the model is always a young
// adult, never a minor. (2) "Eurasian / European bone structure,
// high cheekbones, high bridge" — the face survey did NOT find
// that: no high European bridge, no deep eye sockets, no light
// eyes, no high angular cheekbones in the 20 clear faces. What
// reads as "European" is the STYLING (blonde hair, Paris/studio
// settings, cool editorial attitude) on an East Asian face core —
// dark-brown eyes, small straight low-to-medium nose, soft
// V-line chin. The 3 images sent 2026-11-05 01:38 are still NOT a
// source: they are the ugly generated output (long plain face,
// thin lips both, dull blank stare, flat light-brown hair).
//
// When a face reference IS attached, this face system is never
// used — the reference face wins, exactly as attached.
export const LANUPE_FACE = {
  youth: "a young adult woman, youthful and fresh — slightly full cheeks, very bright smooth skin and a dewy glow that read young, never middle-aged, tired or haggard",
  face: "soft oval face leaning to a soft V-line: high smooth forehead, low soft cheekbones with no strong angles, small slightly pointed chin, narrow soft jawline, cheeks slightly full, never long, plain or hollow",
  eyes: "medium almond-shaped eyes, dark brown almost black, outer corners slightly upturned, thin soft double-eyelid crease, long naturally curled lashes, thin eyeliner, a clear catchlight when looking at the camera, never light-coloured eyes, never deep-set European eye sockets",
  brows: "slim to medium dark-brown or black brows, almost straight then gently curved at the tail, tapered tail, never thick, harsh, flat-straight or sharply angled",
  nose: "straight nose, low to medium bridge, small rounded tip, narrow nostrils — not a high sharp European bridge",
  lips: "small mouth, thin upper lip with a light heart-shaped outline, lower lip slightly fuller than the upper, natural pale pink to earthy pink, never dark red, never overly glossy, lips slightly parted or softly pouting, never a broad smile",
  skin: "very bright warm-neutral skin, dewy glow on the cheekbones and nose bridge, light pink blush, even tone with visible real texture and pores, subtle film grain, never grey, flat or matte-dead, never plastic",
  makeup: "light to medium makeup, focus on eyes and cheeks: curled lashes, thin liner, light pink blush, earthy-pink lips, no dark-red lips, no heavy contour, no heavy smoky eyes",
  attitude:
    "calm, focused, slightly cold and proud gaze when looking at the camera, a clear directed gaze when looking away or down — youthful and soft but cool, never sweet-cute, never blank, never tired",
  figure: "Tall, slim, elegant figure with long legs and a natural, healthy silhouette — a high-fashion model body, not a generic average body",
  hairVariants: [
    "long, thick, black wavy hair with volume, centre part — the most frequent lanupe_ hair",
    "long, thick, straight platinum-blonde hair with volume",
    "shoulder-length blonde hair, straight with volume",
    "black hair in a low bun, face fully visible",
    "platinum-blonde hair with thick blunt bangs, face framed by the fringe",
  ],
};

// Backwards-compatible alias: older code imported LANUPE_MUSE.
// It now points at the observed face system, not the guessed muse.
export const LANUPE_MUSE = LANUPE_FACE;

// DNA shared by almost every lanupe_ post, whatever the direction.
export const LANUPE_COMMON = {
  framing:
    "vertical photo, full body or three-quarter body as the main frame, eye-level or slightly low camera, subject centred or slightly off-centre with breathing room around the outfit",
  expression:
    "relaxed, cool, detached expression, rarely looking directly at the camera and rarely smiling broadly — looking down, looking away, in profile, or from behind; when she does look at the camera, a calm, sharp, confident gaze, never cute and never tired",
  hair: LANUPE_FACE.hairVariants[0]!,
  face: `${LANUPE_FACE.youth}. ${LANUPE_FACE.face}. Eyes: ${LANUPE_FACE.eyes}. Brows: ${LANUPE_FACE.brows}. Nose: ${LANUPE_FACE.nose}. Lips: ${LANUPE_FACE.lips}. Skin: ${LANUPE_FACE.skin}. Makeup: ${LANUPE_FACE.makeup}. Attitude: ${LANUPE_FACE.attitude}. Hair variants (face stays the same, hair rotates): ${LANUPE_FACE.hairVariants.join(" | ")}.`,
  muse: `${LANUPE_FACE.youth}. ${LANUPE_FACE.face}. ${LANUPE_FACE.figure}. Attitude: ${LANUPE_FACE.attitude}.`,
  accessories: "large leather tote, small shoulder bag, woven bag, belt, sunglasses, fedora hat, boots or pointed high heels",
  grade:
    "warm, muted, slightly soft film-like grade, medium contrast, low saturation, soft natural skin, never neon and never harsh flash",
  multiFrame: "the same outfit is often shown from several angles, as a set",
  negatives: [
    "no older-looking, middle-aged or mature-aged model, no tired or aged face, no heavy wrinkles or sagging skin",
    "no generic average face, no plain or dull-looking model",
    "no long plain face, no thin lips on both lips with a dull blank stare, no flat lifeless hair — the exact face in the ugly generated images to avoid",
    "no high sharp European nose bridge, no deep-set light-coloured eyes, no high angular cheekbones — the observed face core is soft, not a European face",
    "no heavy bokeh that erases the background",
    "no flat phone-snapshot look",
    "no clinical over-sharpening",
    "no distorted hands or fingers",
    "no extra limbs",
    "no warped garment shape, pattern or logo",
    "no over-retouched plastic skin",
    "no beauty filter look",
    "no neon colours",
    "no harsh direct flash",
    "no watermark",
    "no text on the image",
  ],
};

export const LANUPE_DIRECTIONS: LanupeDirection[] = [
  {
    id: "autumnStreet",
    label: "Phố mùa thu, tông trung tính",
    share: "khoảng 36% trong 50 bài",
    palette: "beige, camel, brown, black, grey, cream, ivory, pale blue",
    mood: "calm, elegant, quietly confident, everyday luxury",
    colorTone: "warm, muted, film-like, medium contrast, low saturation",
    lighting:
      "soft natural daylight, gentle golden late-afternoon sun or overcast light, soft shadows, skin rendered smooth and natural",
    outfits: [
      "long beige wool coat over a cream turtleneck, wide-leg brown trousers and pointed heels",
      "camel trench coat over a black turtleneck, pleated midi skirt and knee boots",
      "black leather jacket over a white top, wide-leg jeans and pointed boots",
      "oversized grey wool coat, cream knit, pleated skirt and tall boots",
      "brown faux-fur coat over a silk slip dress, sheer tights and heeled boots",
      "beige double-breasted coat, black wide-leg trousers, leather tote and sunglasses",
      "soft knit sweater, pleated mini skirt, sheer tights and pointed heels",
      "leather trench, turtleneck and straight trousers in one neutral tone",
    ],
    backgrounds: [
      "a European-style street with stone facades and tall windows",
      "a sidewalk in front of a glass storefront, reflections kept soft",
      "a lakeside promenade with calm water and bare trees",
      "a quiet residential street with parked cream vintage cars",
      "a balcony overlooking old rooftops in soft daylight",
      "a rooftop terrace with a low railing and open sky",
      "a cafe terrace with small round tables and warm afternoon light",
      "a stone staircase in front of an old building entrance",
    ],
    poses: [
      "standing full body, one hand holding a large leather tote, looking away down the street",
      "walking towards the camera at a relaxed pace, coat moving slightly, looking down",
      "standing in profile, one hand in a coat pocket, the other holding sunglasses",
      "leaning lightly against a stone wall, legs crossed at the ankles, looking to the side",
      "walking away from the camera, seen from behind, long coat and hair in motion",
      "standing on a staircase, one foot one step higher, hand resting on the railing",
      "pausing mid-step on the sidewalk, turning the head over the shoulder",
      "sitting on a low stone ledge, legs together, hands resting on a bag",
      "standing beside a cream vintage car, one hand on the door, looking away",
      "walking along the lakeside, holding a coffee cup, hair moving in a light breeze",
    ],
    angles: [
      "full body, eye-level, straight-on",
      "full body, slightly low angle, three-quarter view",
      "three-quarter body, eye-level, side profile",
      "full body from behind, eye-level",
      "medium distance full body, slightly low, subject slightly off-centre",
      "close-up detail of the coat collar, belt and bag after the full-body frame",
      "full body, low angle, looking up slightly at the subject against the sky",
      "three-quarter body, eye-level, over-the-shoulder composition",
    ],
    notes: "The flagship lanupe_ look: one neutral outfit, worn as a complete set, in a real everyday setting that never outshines the clothes.",
  },
  {
    id: "mirrorSelfie",
    label: "Ảnh gương tự chụp trong nhà / thang máy",
    share: "khoảng 22% trong 50 bài",
    palette: "black, cream, denim blue, grey, warm indoor browns",
    mood: "casual, intimate, confident, off-duty",
    colorTone: "warm indoor tones, soft and slightly dim, film-like",
    lighting:
      "warm indoor lighting, elevator or bathroom ceiling light, soft reflections in the mirror, no harsh flash",
    outfits: [
      "fitted black long-sleeve top, light-wash wide-leg jeans and pointed heels",
      "cream soft knit sweater, denim mini skirt and boots",
      "black hoodie, straight jeans and sneakers, sunglasses on",
      "fitted ribbed top, pleated skirt and knee boots",
      "oversized grey knit, denim shorts and tall boots",
      "black turtleneck, leather mini skirt and heeled boots",
      "white fitted top, wide-leg denim and a small shoulder bag",
      "soft knit cardigan over a camisole, jeans and flats",
    ],
    backgrounds: [
      "a full-length mirror in a bedroom with a wooden door behind",
      "a mirrored elevator interior with warm ceiling lights",
      "a bathroom mirror above a sink, warm tiles and soft light",
      "a hallway mirror with a wooden console and a bag on it",
      "a dressing-room mirror with warm bulbs and a chair nearby",
      "a mirrored wardrobe door in a bright living room",
    ],
    poses: [
      "standing in front of the mirror, phone in one hand partially covering the lower face, looking at the phone screen",
      "three-quarter body mirror selfie, one hand on the hip, head tilted slightly, sunglasses on",
      "full body mirror selfie, one leg slightly forward, free hand holding a small bag",
      "sitting on the edge of a bathtub, phone raised to the mirror, legs crossed, looking at the screen",
      "standing in an elevator, mirror selfie with the phone at chest height, looking down at the screen",
      "leaning against the mirror frame, one hand touching hair, looking away from the phone",
      "crouching slightly in front of a low mirror, phone in hand, outfit and boots in full view",
      "standing sideways to the mirror, looking over the shoulder into the reflection",
    ],
    angles: [
      "mirror selfie, three-quarter body, phone held at chest height",
      "mirror selfie, full body, straight-on reflection",
      "mirror selfie, close-up of the upper body, belt and bag detail",
      "mirror selfie, slightly low angle, full outfit in the reflection",
      "mirror selfie from the side, reflection and real subject both partly visible",
      "close-up detail of fabric, belt and shoes in the mirror frame",
    ],
    notes: "Shot as if the model took it herself: the phone is part of the picture, the face is often partly covered, and the setting stays domestic and warm.",
  },
  {
    id: "studioLookbook",
    label: "Lookbook studio nền trắng / xám",
    share: "khoảng 16% trong 50 bài",
    palette: "white, light grey, cream, black, beige",
    mood: "clean, premium, catalogue-calm, focused on the garment",
    colorTone: "bright, clean, even tones, true garment colours, soft shadows",
    lighting:
      "even studio lighting, bright and diffused, soft floor shadow, garment detail fully readable",
    outfits: [
      "pleated midi skirt in cream, fitted knit top and pointed heels",
      "short tailored jacket, pleated mini skirt and knee boots",
      "white pleated dress with a thin belt and heeled sandals",
      "beige short coat, straight trousers and pointed heels",
      "black fitted dress, thin belt and tall boots",
      "cream knit set, midi skirt and flats",
      "short wool jacket, denim shorts and heeled boots",
      "grey tailored suit, midi skirt and pointed heels",
    ],
    backgrounds: [
      "a seamless pure white studio backdrop",
      "a seamless light grey studio backdrop",
      "a white studio wall with a soft floor shadow",
      "a light grey studio corner with a single stool as a prop",
    ],
    poses: [
      "standing full body, front-facing, balanced commercial pose, arms relaxed at the sides",
      "standing full body, three-quarter view, one hand relaxed near the waist",
      "standing full body, one hand on the hip, looking slightly down",
      "walking slowly towards the camera in the studio, looking away",
      "standing in profile, showing the side line of the garment",
      "sitting on a studio stool, legs crossed, back straight, looking to the side",
      "standing with back to the camera, head turned over the shoulder",
      "standing full body, hands lightly holding the hem of the skirt",
    ],
    angles: [
      "full body, eye-level, straight-on",
      "full body, eye-level, three-quarter view",
      "full body, eye-level, side profile",
      "full body from behind, head turned over the shoulder",
      "three-quarter body, eye-level, garment detail in focus",
      "close-up detail of pleats, collar, belt and stitching",
    ],
    notes: "The clearest, most commercial direction: no street story, just the garment, its form and its fabric, presented as a set of angles.",
  },
  {
    id: "blackEvening",
    label: "Tông đen, ren, xuyên thấu — buổi tối / trong nhà",
    share: "khoảng 12% trong 50 bài",
    palette: "black, charcoal, deep brown, warm candlelight gold",
    mood: "quiet, moody, sensual but discreet, evening calm",
    colorTone: "warm, dark, muted, low-key, soft glow, never garish",
    lighting:
      "warm dim indoor light, candlelight or warm lamps, soft glow on skin, shadows kept gentle",
    outfits: [
      "short black lace dress, sheer tights and high boots",
      "black sheer long-sleeve top, black mini skirt and knee boots",
      "black off-shoulder top, wide-leg black trousers and pointed heels",
      "black slip dress with lace trim, thin belt and heeled boots",
      "black fitted dress with sheer sleeves and a small shoulder bag",
      "black lace camisole, black pleated mini skirt and tall boots",
    ],
    backgrounds: [
      "a living room in the evening, sofa and warm lamps behind",
      "a bedroom mirror with warm light and a wooden wardrobe",
      "a hallway with warm wall lights and a marble wall",
      "an indoor wall with soft candlelight and dark wood furniture",
      "a dim cafe corner in the evening, warm pendant lights",
    ],
    poses: [
      "sitting on a sofa, legs crossed, one arm resting on the backrest, looking away",
      "crouching in front of a mirror, looking into the reflection, hands resting on the knees",
      "leaning against a wall, one shoulder to the wall, looking down",
      "sitting on the floor beside a bed, knees bent, arms relaxed, looking to the side",
      "standing in profile in dim light, one hand touching hair, looking away",
      "sitting on a chair, back straight, legs crossed, hands in the lap, calm expression",
      "standing in front of a mirror, seen from behind, head turned slightly",
    ],
    angles: [
      "three-quarter body, eye-level, warm dim light",
      "full body, slightly low angle, seated pose",
      "close-up of lace, sheer fabric and boots in warm light",
      "mirror reflection, three-quarter body, looking into the mirror",
      "full body, eye-level, leaning against a wall",
      "medium shot, eye-level, seated, background kept readable",
    ],
    notes: "The darkest lanupe_ direction, but still soft and discreet: warm light, covered elegance, never loud or overly exposed.",
  },
  {
    id: "summerBright",
    label: "Mùa hè, ánh sáng ban ngày tươi hơn",
    share: "khoảng 8% trong 50 bài",
    palette: "white, light blue, pale denim, cream, soft pastel",
    mood: "light, fresh, youthful, relaxed summer day",
    colorTone: "bright, natural, clear daylight, still soft and film-like",
    lighting:
      "bright natural daylight, sunny but soft, clear shadows, fresh skin",
    outfits: [
      "white fitted top, light-wash jeans and ballet flats",
      "pale blue shirt, white mini skirt and flats",
      "white camisole, light denim shorts and sandals",
      "cream linen dress, small shoulder bag and flats",
      "light blue denim jacket over a white dress and sneakers",
      "white short-sleeve top, pleated light skirt and ballet flats",
    ],
    backgrounds: [
      "a sunny street with light-coloured shopfronts",
      "a bright shopping mall corridor with glass and daylight",
      "a bedroom with white bedding and morning sunlight",
      "a sunny park path with green trees and soft light",
      "a bright cafe terrace in the morning",
      "a light-coloured apartment balcony in daylight",
    ],
    poses: [
      "walking in sunlight, looking away, hair moving lightly",
      "standing full body in daylight, one hand holding a small bag, smiling softly",
      "sitting on a bed in morning light, legs crossed, looking out of the window",
      "standing in a mall corridor, looking at shop windows, relaxed posture",
      "sitting on a park bench, hands resting on the knees, looking to the side",
      "standing on a balcony, one hand on the railing, looking into the distance",
    ],
    angles: [
      "full body, eye-level, straight-on in daylight",
      "full body, slightly low angle, three-quarter view",
      "three-quarter body, eye-level, walking pose",
      "medium shot, eye-level, seated in daylight",
      "full body, eye-level, from a medium distance with the setting readable",
    ],
    notes: "The lightest direction in the set: same relaxed model language, but brighter light, lighter fabrics and a younger, fresher feeling.",
  },
];

// Extra poses / angles / backgrounds shared across directions, so a
// suggestion is never limited to one direction's short list.
export const LANUPE_EXTRA_POSES = [
  "standing full body, weight on one leg, the other leg slightly bent, looking away",
  "walking down a staircase, one hand on the railing, looking down",
  "sitting on a window ledge, one leg bent, looking out of the window",
  "standing with arms loosely crossed, looking to the side",
  "turning around mid-walk, coat and hair in motion, looking over the shoulder",
  "sitting cross-legged on the floor, back straight, hands resting on the knees",
  "leaning on a balcony railing with both forearms, looking into the distance",
  "standing in a doorway, one hand on the door frame, looking out",
  "walking with a bag over the shoulder, free hand adjusting sunglasses",
  "sitting on steps, elbows on knees, chin slightly down, looking away",
  "standing beside a window, side profile, soft light on the face",
  "lying on a bed in daylight, propped on one elbow, looking at the camera calmly",
];

export const LANUPE_EXTRA_ANGLES = [
  "full body, eye-level, straight-on, subject centred",
  "full body, slightly low angle, subject slightly off-centre",
  "three-quarter body, eye-level, side profile",
  "full body from behind, eye-level",
  "medium shot from the waist up, eye-level, background readable",
  "close-up detail of fabric texture, buttons, belt or shoes",
  "full body, high angle looking slightly down, seated subject",
  "full body, low angle, subject against the sky or ceiling",
  "over-the-shoulder shot, subject looking away into the scene",
  "wide shot, subject small in the frame, setting clearly readable",
];

export const LANUPE_EXTRA_BACKGROUNDS = [
  "a quiet side street with old facades and soft daylight",
  "a vintage car interior, cream leather seats, warm daylight through the windows",
  "a Japanese-style room with wooden panels and soft paper light",
  "an airport lounge corridor with large windows and daylight",
  "a brick corridor with warm wall lights",
  "a zoo pathway with greenery and soft daylight",
  "a bookshop interior with wooden shelves and warm lamps",
  "a hotel lobby with marble floors and soft ceiling light",
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function lanupeDirectionById(id: string): LanupeDirection {
  return LANUPE_DIRECTIONS.find((d) => d.id === id) ?? LANUPE_DIRECTIONS[0]!;
}

export interface DetailedPromptInput {
  directionId?: LanupeDirectionId | "auto";
  outfit?: string;
  background?: string;
  pose?: string;
  angle?: string;
  hair?: string;
  seed?: string;
  hasFaceReference?: boolean;
  hasOutfitReference?: boolean;
}

// One detailed prompt. Only the SECTION ORDER is taken from the
// user's reference example (face, features, skin, face lighting,
// makeup, NEGATIVE, skin tone, outfit, posture, location, background,
// lighting, mood, colour, style, camera, additions). Every word of
// content below is lanupe_-specific and editorially optimised —
// nothing from that example's subject, setting, makeup or camera
// wording is copied: no sports theme, no arena light, no strawberry
// lipstick, no f/22, no mobile-phone sensor, no porcelain/jelly skin.
export function buildDetailedPrompt(input: DetailedPromptInput): string {
  const direction =
    input.directionId && input.directionId !== "auto"
      ? lanupeDirectionById(input.directionId)
      : pick(LANUPE_DIRECTIONS);
  const outfit = input.outfit ?? pick(direction.outfits);
  const background = input.background ?? pick([...direction.backgrounds, ...LANUPE_EXTRA_BACKGROUNDS]);
  const pose = input.pose ?? pick([...direction.poses, ...LANUPE_EXTRA_POSES]);
  const angle = input.angle ?? pick([...direction.angles, ...LANUPE_EXTRA_ANGLES]);
  const hair = input.hair ?? pick(LANUPE_FACE.hairVariants);
  const seed = input.seed?.trim();
  const faceLine = input.hasFaceReference
    ? "Please create a photo with a face that is exactly the same as the attached image, without alteration. Do not change the face shape, eyes, nose, mouth, hair style or skin tone from the reference."
    : `Please create a photorealistic fashion photo of ${LANUPE_FACE.youth}. ${LANUPE_FACE.face}. Hair: ${hair}. ${LANUPE_FACE.figure}. Attitude: ${LANUPE_FACE.attitude}.`;
  const sections = [
    `${faceLine} The style should be a lanupe_-style fashion portrait: ${direction.notes}`,
    seed ? `User idea to keep: ${seed}.` : "",
    input.hasFaceReference
      ? "• Facial features: Exactly as in the attached face reference — do not beautify, age, reshape or replace it with a generic model face."
      : `• Facial features: ${LANUPE_FACE.face}. Eyes: ${LANUPE_FACE.eyes}. Brows: ${LANUPE_FACE.brows}. Nose: ${LANUPE_FACE.nose}. Lips: ${LANUPE_FACE.lips}. Hair: ${hair} (the face core above stays exactly the same whatever the hair variant). Youthful, fresh and striking — a face that could be a fashion editorial cover, not an average face.`,
    `• Skin / Face: ${LANUPE_FACE.skin}. Skin must look real and photographed, not plastic, not airbrushed and not over-smoothed.`,
    "• Lighting on the face: Soft directional light on the face, matched to the scene lighting, with gentle shadow modelling that keeps the facial features readable without harsh contrast.",
    `• Makeup: ${LANUPE_FACE.makeup}. Fresh and understated, never heavy or theatrical.`,
    `❌ NEGATIVE: ${LANUPE_COMMON.negatives.join(", ")}.`,
    "• Skin tone: Very bright warm-neutral skin tone, dewy glow, fresh and luminous, with real texture, neither grey nor orange.",
    `• Outfit: ${outfit}. Every garment detail must stay exact: shape, fabric, colour, pattern, fit and stitching. ${input.hasOutfitReference ? "Use the clothing and footwear only from the attached outfit reference." : ""}`,
    `• Posture: ${pose}. Natural, feminine and authentic posture, coherent hands and feet, no stiff catalogue posing.`,
    `• Location: ${background}.`,
    "• Background: Clearly readable setting in natural depth: the subject is tack sharp, the setting is recognisable in every detail, with gentle natural depth rather than heavy blur or flat clinical sharpness everywhere. Editorial film photography, not a phone snapshot.",
    `• Lighting: ${direction.lighting}.`,
    `• Mood: ${direction.mood}.`,
    `• Color Tone: ${direction.colorTone}. Palette: ${direction.palette}.`,
    `• Style: High-resolution editorial fashion photography, ${LANUPE_COMMON.grade}, subtle Kodak Portra 400 film grain, natural lifestyle, ${LANUPE_COMMON.multiFrame}. Framing: ${LANUPE_COMMON.framing}. Expression: ${LANUPE_COMMON.expression}.`,
    `• Camera: ${angle}, 85mm portrait lens, f/2.8, subject sharp, vertical framing.`,
    "• Additions: Background stays readable, depth is gentle and natural, subject and setting both clear, no heavy blur, no flat over-sharpened phone look.",
  ];
  return sections.filter(Boolean).join("\n\n");
}

// Three different detailed prompts: different directions (or different
// pose / angle / background / outfit within one direction), so the
// user gets genuinely different options, not three rewordings.
export function randomDetailedPrompts(
  directionId: LanupeDirectionId | "auto" = "auto",
  seed = "",
  hasFaceReference = false,
  count = 3,
): string[] {
  const directions =
    directionId === "auto"
      ? [...LANUPE_DIRECTIONS].sort(() => Math.random() - 0.5).slice(0, count)
      : Array.from({ length: count }, () => lanupeDirectionById(directionId));
  return directions.map((direction) =>
    buildDetailedPrompt({
      directionId: direction.id,
      seed,
      hasFaceReference,
    }),
  );
}
