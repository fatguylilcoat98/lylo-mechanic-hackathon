import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// Minimal testing helpers (avoids adding @testing-library as a dependency).
function textOf(node) {
  if (typeof node === 'string') return node;
  if (!node || !node.children) return '';
  return node.children.map(textOf).join('');
}

function render(el) {
  let r;
  act(() => { r = TestRenderer.create(el); });
  const root = () => r.root;
  const match = (m, s) => (m instanceof RegExp ? m.test(s) : s === m);
  const allText = (m) => root().findAll((n) => n.type === 'Text' || (n.type && n.type.displayName === 'Text'))
    .filter((n) => typeof n.type === 'string' && match(m, textOf(n)));
  const pressableFor = (n) => { let c = n; while (c && !c.props.onPress) c = c.parent; return c || n; };
  const api = {
    getAllByText: (m) => { const a = allText(m); if (!a.length) throw new Error('No text ' + m); return a; },
    getByText: (m) => api.getAllByText(m)[0],
    queryByText: (m) => allText(m)[0] || null,
    findByText: async (m) => {
      for (let i = 0; i < 40; i++) {
        const a = allText(m); if (a.length) return a[0];
        await act(async () => { await new Promise((res) => setTimeout(res, 25)); });
      }
      throw new Error('Timed out waiting for text ' + m);
    },
    findByPlaceholderText: async (m) => {
      for (let i = 0; i < 40; i++) {
        const a = root().findAll((n) => typeof n.type === 'string' && n.props.placeholder && match(m, n.props.placeholder));
        if (a.length) return a[0];
        await act(async () => { await new Promise((res) => setTimeout(res, 25)); });
      }
      throw new Error('No placeholder ' + m);
    },
    // v0.4.5 hackathon: find by testID (host node)
    queryByTestId: (id) => root().findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0] || null,
    getByTestId: (id) => { const n = api.queryByTestId(id); if (!n) throw new Error('No testID ' + id); return n; },
    _pressableFor: pressableFor,
    unmount: () => act(() => { r.unmount(); }),
  };
  return api;
}

const fireEvent = {
  press: (n) => { let c = n; while (c && !c.props.onPress) c = c.parent; act(() => { c.props.onPress(); }); },
  changeText: (n, t) => { let c = n; while (c && !c.props.onChangeText) c = c.parent; act(() => { c.props.onChangeText(t); }); },
};

export { render, fireEvent, act };
