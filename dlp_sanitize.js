const ACCENT_CHARS = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a', 'æ': 'ae',
  'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ì': 'i', 'í': 'i',
  'î': 'i', 'ï': 'i', 'ñ': 'n', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'ö': 'o',
  'õ': 'o', 'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ý': 'y', 'ÿ': 'y',
  'À': 'A', 'Á': 'A', 'Â': 'A', 'Ä': 'A', 'Ã': 'A', 'Å': 'A', 'Æ': 'AE',
  'Ç': 'C', 'È': 'E', 'É': 'E', 'Ê': 'E', 'Ë': 'E', 'Ì': 'I', 'Í': 'I',
  'Î': 'I', 'Ï': 'I', 'Ñ': 'N', 'Ò': 'O', 'Ó': 'O', 'Ô': 'O', 'Ö': 'O',
  'Õ': 'O', 'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'Ü': 'U', 'Ý': 'Y'
};

module.exports = function sanitizeFilename(s, restricted = true, isId = undefined) {
  try {
    if (s === '') return '';

    function replaceInsane(char) {
      if (restricted && ACCENT_CHARS[char]) {
        return ACCENT_CHARS[char];
      } else if (!restricted && char === '\n') {
        return '\0 ';
      } else if (isId === undefined && !restricted && '"*:<>?|/\\'.includes(char)) {
        return { '/': '\u29F8', '\\': '\u29F9' }[char] || String.fromCharCode(char.charCodeAt(0) + 0xfee0);
      } else if (char === '?' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) {
        return '';
      } else if (char === '"') {
        return restricted ? '' : '\'';
      } else if (char === ':') {
        return restricted ? '\0_\0-' : '\0 \0-';
      } else if ('\\/|*<>'.includes(char)) {
        return '\0_';
      }

      if (restricted && ('!&\'()[]{}$;`^,#'.includes(char) || char.trim() === '' || char.charCodeAt(0) > 127)) {
        return '_';
      }

      return char;
    }

    // Replace look-alike Unicode glyphs
    if (restricted && (isId === undefined || !isId)) {
      s = s.normalize('NFKC');
    }

    s = s.replace(/[0-9]+(?::[0-9]+)/g, match => match.replace(/:/g, '_'));

    let result = Array.from(s).map(replaceInsane).join('');

    if (isId === undefined) {
      result = result.replace(/(\0.)(?:(?=\1)..)+/g, '$1'); // Remove repeated substitute chars
      const STRIP_RE = '(?:\0.|[ _-])*';
      const startEndStrip = new RegExp(`^${STRIP_RE}|${STRIP_RE}$`, 'g');
      result = result.replace(startEndStrip, ''); // Remove substitute chars from start/end
    }

    result = result.replace(/\0/g, '') || '_';

    if (!isId) {
      while (result.includes('__')) {
        result = result.replace(/__+/g, '_');
      }
      result = result.replace(/^_+|_+$/g, '');

      // Common case of "Foreign band name - English song title"
      if (restricted && result.startsWith('-_')) {
        result = result.substring(2);
      }
      if (result.startsWith('-')) {
        result = '_' + result.substring(1);
      }
      result = result.replace(/^\.+/, '');
      if (result === '') {
        result = '_';
      }
    }

    return result;
  } catch (err) {
    console.error(s);
    console.error(err);
    return s;
  }
}