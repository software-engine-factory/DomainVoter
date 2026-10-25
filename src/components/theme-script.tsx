import { THEMES, THEME_STORAGE_KEY } from "@/lib/theme/themes";

// Runs before paint: a valid localStorage choice wins over the cookie.
export function ThemeScript() {
  const ids = JSON.stringify(THEMES.map((theme) => theme.id));
  const code = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(${ids}.indexOf(t)>-1)document.documentElement.dataset.theme=t}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
