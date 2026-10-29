/**
 * Whether a text names someone: their full name, or their first name alone, as a capitalised
 * whole word, possessive or not ("Gabriel's organization", "Buffy Summers' house"). Capitals
 * keep "Will" from matching "will" and "Hope" from "hope"; whole words keep "Oz" out of "dozen".
 */
export function mentions(text: string, name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A first name alone only for a name that reads as one ("Willow Rosenberg", "Jean de Florette"),
  // not a description the tracker filed as a person ("Gabriel's mom (name unknown)").
  const nameLike = words.every((w) => /^\p{Lu}[\p{L}’'.-]*$/u.test(w) && !/['’]s$/.test(w) || /^(?:of|de|del|der|van|von|la|le|da|di|du|al|bin|ibn)$/.test(w));
  const forms = [words.join(" "), ...(nameLike && words.length > 1 && words[0]!.length >= 3 ? [words[0]!] : [])];
  return forms.some((f) => {
    if (f.length < 2) return false;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(f)}(?:['’]s?)?(?![\\p{L}\\p{N}])`, "giu");
    // The text's own spelling must start with a capital, as a name does.
    return [...text.matchAll(re)].some((m) => /^\p{Lu}/u.test(m[0]));
  });
}
