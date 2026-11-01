/** Wrap fenced code blocks in native, keyboard-accessible disclosure controls. */
export default function rehypeCollapsibleCode() {
  return (tree) => {
    function visit(parent) {
      if (!Array.isArray(parent.children)) return;
      parent.children = parent.children.map((node) => {
        if (node.type === 'element' && node.tagName === 'pre'
          && node.children?.some((child) => child.tagName === 'code')) {
          const code = node.children.find((child) => child.tagName === 'code');
          const classes = code.properties?.className ?? [];
          const languageClass = (Array.isArray(classes) ? classes : String(classes).split(' '))
            .find((name) => name.startsWith('language-'));
          const language = node.properties?.dataLanguage
            ?? node.properties?.['data-language']
            ?? languageClass?.slice(9)
            ?? 'text';
          const label = ({ cpp: 'C++', 'c++': 'C++', text: 'TEXT', plaintext: 'TEXT' })[language]
            ?? String(language).toUpperCase();
          return {
            type: 'element', tagName: 'details',
            properties: { className: ['code-disclosure'], open: true },
            children: [
              { type: 'element', tagName: 'summary', properties: {},
                children: [{ type: 'text', value: label }] },
              node,
            ],
          };
        }
        visit(node);
        return node;
      });
    }
    visit(tree);
  };
}
