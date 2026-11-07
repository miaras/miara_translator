export function parseTerms(text = '') {
    const pairs = [];
    for (const [index, line] of text.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        const separator = line.indexOf('=');
        const source = line.slice(0, separator).trim(), target = line.slice(separator + 1).trim();
        if (separator < 1 || !source || !target) throw new Error(`Term on line ${index + 1}: use source = preferred translation.`);
        if (source.length > 200 || target.length > 200) throw new Error('Each term and translation must be 200 characters or fewer.');
        pairs.push([source, target]);
    }
    const terms = Object.fromEntries(pairs);
    if (Object.keys(terms).length > 500) throw new Error('Use up to 500 custom terms.');
    return terms;
}
export const formatTerms = terms => Object.entries(terms || {}).map(([source, target]) => `${source} = ${target}`).join('\n');
export function mergeTerms(extracted = {}, custom = {}) {
    const pinned = Object.entries(custom);
    return Object.fromEntries([...Object.entries(extracted).filter(([key]) => !Object.hasOwn(custom, key)).slice(-(500 - pinned.length) || Infinity), ...pinned].slice(-500));
}
