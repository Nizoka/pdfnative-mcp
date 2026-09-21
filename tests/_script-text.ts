/**
 * One short native-script sample per `lang` code of add_international_text.
 *
 * Shared by tests/scripts-27.test.ts and the engine-surface matrix, which
 * holds this table to `SCRIPT_CODES` (27 scripts, pdfnative 1.8.0): a script
 * added to the tool without a sample here fails the suite.
 */
export const SCRIPT_SAMPLES: Readonly<Record<string, { readonly name: string; readonly text: string }>> = {
    ar: { name: 'Arabic', text: 'مرحبا بالعالم' },
    he: { name: 'Hebrew', text: 'שלום עולם' },
    th: { name: 'Thai', text: 'สวัสดีชาวโลก' },
    ja: { name: 'Japanese', text: 'こんにちは世界' },
    zh: { name: 'Chinese (Simplified)', text: '你好世界' },
    ko: { name: 'Korean', text: '안녕하세요 세계' },
    el: { name: 'Greek', text: 'Γειά σου Κόσμε' },
    hi: { name: 'Devanagari (Hindi)', text: 'नमस्ते दुनिया' },
    bn: { name: 'Bengali', text: 'ওহে বিশ্ব' },
    ta: { name: 'Tamil', text: 'வணக்கம் உலகம்' },
    ru: { name: 'Cyrillic (Russian)', text: 'Привет мир' },
    ka: { name: 'Georgian', text: 'გამარჯობა მსოფლიო' },
    hy: { name: 'Armenian', text: 'Բարեւ աշխարհ' },
    tr: { name: 'Turkish', text: 'Merhaba dünya, İstanbul şehri' },
    pl: { name: 'Polish', text: 'Zażółć gęślą jaźń' },
    vi: { name: 'Vietnamese', text: 'Xin chào thế giới' },
    te: { name: 'Telugu', text: 'హలో ప్రపంచం' },
    si: { name: 'Sinhala', text: 'හෙලෝ ලෝකය' },
    bo: { name: 'Tibetan', text: 'བཀྲ་ཤིས་བདེ་ལེགས།' },
    km: { name: 'Khmer', text: 'សួស្តីពិភពលោក' },
    my: { name: 'Myanmar', text: 'မင်္ဂလာပါ ကမ္ဘာ' },
    am: { name: 'Ethiopic (Amharic)', text: 'ሰላም ልዑል' },
    // pdfnative 1.8.0
    lo: { name: 'Lao', text: 'ສະບາຍດີຊາວໂລກ' },
    nod: { name: 'Tai Tham (Lanna)', text: 'ᨣᩤᩴᨾᩮᩬᩥᨦ' },
    khb: { name: 'New Tai Lue', text: 'ᦎᦷᦑᦺᦟᦹᧉ' },
    tdd: { name: 'Tai Le', text: 'ᥖᥭᥰ ᥖᥬᥲ ᥑᥨᥒᥰ' },
    cjm: { name: 'Cham', text: 'ꨀꨇꩉ ꨌꩌ' },
};

/** Latin-script languages served by the `latin` module through an alias (pdfnative 1.8.0 latin-marks shaper). */
export const ALIAS_SAMPLES: Readonly<Record<string, { readonly name: string; readonly text: string }>> = {
    ha: { name: 'Hausa', text: 'Ina kwana? Ƙasar Hausa da ɗan Adam.' },
    yo: { name: 'Yoruba', text: 'Ẹ káàárọ̀, ọ̀rẹ́ mi. Báwo ni?' },
    ig: { name: 'Igbo', text: 'Ị́bọ̀ọ́lá chi, kedụ ka ị mere?' },
    sw: { name: 'Swahili', text: 'Habari ya asubuhi, rafiki yangu.' },
};
