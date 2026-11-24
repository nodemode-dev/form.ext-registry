import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PdfName,
  PdfRef,
  PdfString,
  PdfDict,
  PdfStream,
  PdfError,
  Lexer,
  ByteWriter,
  name,
  isName,
  dict,
  latin1,
  fromLatin1,
  indexOf,
  lastIndexOf,
  nameText,
  numText,
  stringText,
  writeValue,
  visitRefs,
} from '../../../extensions/mail-merge/src/pdf/objects.ts';
import type { PdfValue } from '../../../extensions/mail-merge/src/pdf/objects.ts';

const raw = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const lex = (s: string) => new Lexer(raw(s));
const one = (s: string) => lex(s).value();
const str = (s: string): number[] => {
  const v = one(s);
  assert.ok(v instanceof PdfString);
  return Array.from(v.bytes);
};
const codes = (s: string): number[] => Array.from(raw(s));

test('integers parse with and without a sign', () => {
  assert.equal(one('123'), 123);
  assert.equal(one('43445'), 43445);
  assert.equal(one('+17'), 17);
  assert.equal(one('-98'), -98);
  assert.equal(one('0'), 0);
});

test('reals parse with signs, a leading dot and a trailing dot', () => {
  assert.equal(one('34.5'), 34.5);
  assert.equal(one('-3.62'), -3.62);
  assert.equal(one('+123.6'), 123.6);
  assert.equal(one('4.'), 4);
  assert.equal(one('-.002'), -0.002);
  assert.equal(one('.5'), 0.5);
  assert.equal(one('0.0'), 0);
  const l = lex('12/Next');
  assert.equal(l.value(), 12);
  const n = l.value();
  assert.ok(n instanceof PdfName);
  assert.equal(n.name, 'Next');
});

test('true false and null are read as keywords', () => {
  const l = lex('true false null');
  assert.equal(l.value(), true);
  assert.equal(l.value(), false);
  assert.equal(l.value(), null);
  assert.equal(l.pos, 15);
  assert.throws(() => one('trueish'), PdfError);
  assert.throws(() => one('xyz'), PdfError);
});

test('names are read up to white space or a delimiter', () => {
  const l = lex('/Name1/A;Name_With-Various***Characters? /1.2 /$$(x)');
  const got: string[] = [];
  for (let i = 0; i < 4; i++) {
    const v = l.value();
    assert.ok(v instanceof PdfName);
    got.push(v.name);
  }
  assert.deepEqual(got, ['Name1', 'A;Name_With-Various***Characters?', '1.2', '$$']);
});

test('names decode two digit hex escapes', () => {
  assert.equal((one('/A#42') as PdfName).name, 'AB');
  assert.equal((one('/Lime#20Green') as PdfName).name, 'Lime Green');
  assert.equal((one('/paired#28#29parentheses') as PdfName).name, 'paired()parentheses');
  assert.equal((one('/The_Key_of_F#23_Minor') as PdfName).name, 'The_Key_of_F#_Minor');
  assert.equal((one('/#e9t#E9') as PdfName).name, 'été');
});

test('a lone slash is the empty name', () => {
  const l = lex('/ 7');
  const v = l.value();
  assert.ok(v instanceof PdfName);
  assert.equal(v.name, '');
  assert.equal(l.value(), 7);
  const arr = one('[/]') as PdfValue[];
  assert.equal(arr.length, 1);
  assert.ok(isName(arr[0], ''));
});

test('literal strings keep balanced nested parentheses', () => {
  assert.deepEqual(str('(This is a string)'), codes('This is a string'));
  assert.deepEqual(str('(a (b (c) d) e)'), codes('a (b (c) d) e'));
  assert.deepEqual(str('()'), []);
  assert.deepEqual(str('(*!&}^% and so on)'), codes('*!&}^% and so on'));
  assert.deepEqual(str('(50% off\n)'), codes('50% off\n'));
  const v = one('(ab)');
  assert.ok(v instanceof PdfString);
  assert.equal(v.hex, false);
});

test('literal string named escapes map to their control bytes', () => {
  assert.deepEqual(str('(\\n\\r\\t\\b\\f)'), [10, 13, 9, 8, 12]);
  assert.deepEqual(str('(\\(\\)\\\\)'), [40, 41, 92]);
  const l = lex('(a\\)b\\(c) 9');
  const v = l.value();
  assert.ok(v instanceof PdfString);
  assert.deepEqual(Array.from(v.bytes), codes('a)b(c'));
  assert.equal(l.value(), 9);
  assert.deepEqual(str('(a\\qb)'), codes('aqb'));
});

test('octal escapes take one to three digits', () => {
  assert.deepEqual(str('(\\101)'), [65]);
  assert.deepEqual(str('(\\53)'), [43]);
  assert.deepEqual(str('(\\0053)'), [5, 51]);
  assert.deepEqual(str('(\\053)'), [43]);
  assert.deepEqual(str('(\\5x)'), [5, 120]);
  assert.deepEqual(str('(\\0)'), [0]);
  assert.deepEqual(str('(\\245\\307)'), [165, 199]);
  assert.deepEqual(str('(\\18)'), [1, 56]);
});

test('a backslash at a line end joins the lines', () => {
  assert.deepEqual(str('(ab\\\ncd)'), codes('abcd'));
  assert.deepEqual(str('(ab\\\rcd)'), codes('abcd'));
  assert.deepEqual(str('(ab\\\r\ncd)'), codes('abcd'));
});

test('an unescaped line end inside a literal string reads as one line feed', { todo: 'defect: a bare CR or CRLF inside a literal string is kept as is, ISO 32000 7.3.4.2 says it reads as a single LF' }, () => {
  assert.deepEqual(str('(a\nb)'), [97, 10, 98]);
  assert.deepEqual(str('(a\r\nb)'), [97, 10, 98]);
  assert.deepEqual(str('(a\rb)'), [97, 10, 98]);
});

test('hex strings decode pairs and ignore white space', () => {
  assert.deepEqual(str('<4E6F762073686D6F7A>'), codes('Nov shmoz'));
  assert.deepEqual(str('<48 65\n6C\t6c\r\n6F>'), codes('Hello'));
  assert.deepEqual(str('<>'), []);
  const v = one('<00ff>');
  assert.ok(v instanceof PdfString);
  assert.equal(v.hex, true);
  assert.deepEqual(Array.from(v.bytes), [0, 255]);
  const inside = one('<</ID<4142>/K<<>>>>');
  assert.ok(inside instanceof PdfDict);
  assert.deepEqual(Array.from((inside.get('ID') as PdfString).bytes), [0x41, 0x42]);
  const empty = inside.get('K');
  assert.ok(empty instanceof PdfDict);
  assert.equal(empty.map.size, 0);
});

test('a hex string with an odd digit count pads the last digit with zero', () => {
  assert.deepEqual(str('<901FA>'), [0x90, 0x1f, 0xa0]);
  assert.deepEqual(str('<7>'), [0x70]);
});

test('arrays hold mixed values and nest', () => {
  const v = one('[549 3.14 false (Ralph) /SomeName [1 [2]] null]') as PdfValue[];
  assert.ok(Array.isArray(v));
  assert.equal(v.length, 7);
  assert.equal(v[0], 549);
  assert.equal(v[1], 3.14);
  assert.equal(v[2], false);
  assert.deepEqual(Array.from((v[3] as PdfString).bytes), codes('Ralph'));
  assert.ok(isName(v[4], 'SomeName'));
  assert.deepEqual(v[5], [1, [2]]);
  assert.equal(v[6], null);
  assert.deepEqual(one('[]'), []);
});

test('dictionaries hold typed entries and nest', () => {
  const v = one('<</Type/Example /Version 0.01 /Int 12 /S (a string) /Sub << /Item1 0.4 /Arr [1 2] >> /Flag true>>');
  assert.ok(v instanceof PdfDict);
  assert.equal(v.map.size, 6);
  assert.ok(isName(v.get('Type'), 'Example'));
  assert.equal(v.get('Version'), 0.01);
  assert.equal(v.get('Int'), 12);
  assert.deepEqual(Array.from((v.get('S') as PdfString).bytes), codes('a string'));
  const sub = v.get('Sub');
  assert.ok(sub instanceof PdfDict);
  assert.equal(sub.get('Item1'), 0.4);
  assert.deepEqual(sub.get('Arr'), [1, 2]);
  assert.equal(v.get('Flag'), true);
  const l = lex('<< /A 1 >> endobj');
  assert.ok(l.value() instanceof PdfDict);
  assert.equal(l.pos, 10);
  assert.equal(l.word(), 'endobj');
});

test('an indirect reference is read as one value', () => {
  const v = one('12 0 R');
  assert.ok(v instanceof PdfRef);
  assert.equal(v.num, 12);
  assert.equal(v.gen, 0);
  const w = one('7 65535 R');
  assert.ok(w instanceof PdfRef);
  assert.equal(w.num, 7);
  assert.equal(w.gen, 65535);
});

test('two plain numbers without the R keyword stay two numbers', () => {
  const l = lex('12 0 obj');
  assert.equal(l.value(), 12);
  assert.equal(l.value(), 0);
  assert.equal(l.word(), 'obj');
  assert.deepEqual(one('[12 0]'), [12, 0]);
  assert.deepEqual(one('[0 0 612 792]'), [0, 0, 612, 792]);
  const v = one('[1 2 3 R 4 5 0 R -1 0 6 0 R]') as PdfValue[];
  assert.equal(v.length, 7);
  assert.equal(v[0], 1);
  assert.deepEqual(v[1], new PdfRef(2, 3));
  assert.equal(v[2], 4);
  assert.deepEqual(v[3], new PdfRef(5, 0));
  assert.equal(v[4], -1);
  assert.equal(v[5], 0);
  assert.deepEqual(v[6], new PdfRef(6, 0));
});

test('comments are skipped up to the line end', () => {
  assert.equal(one('% a comment (with [delimiters\n42'), 42);
  assert.equal(one('%first\r%second\r\n  /N'.concat('')) instanceof PdfName, true);
  assert.deepEqual(one('[1 % one\n2 %two\r3]'), [1, 2, 3]);
  const d = one('<< /A % note >>\n 5 >>');
  assert.ok(d instanceof PdfDict);
  assert.equal(d.get('A'), 5);
});

test('all six white space characters separate tokens', () => {
  const l = lex('\x00\t\n\f\r 1\x002\t3\n4\f5\r6 7');
  const got: PdfValue[] = [];
  for (let i = 0; i < 7; i++) got.push(l.value());
  assert.deepEqual(got, [1, 2, 3, 4, 5, 6, 7]);
  assert.throws(() => l.value(), PdfError);
});

test('a stream takes its data after the keyword and a line feed', () => {
  const l = lex('<< /Length 5 >>\nstream\nhello\nendstream\nendobj');
  const v = l.value();
  assert.ok(v instanceof PdfStream);
  assert.equal(latin1(v.data), 'hello');
  assert.equal(v.dict.get('Length'), 5);
  assert.equal(l.word(), 'endobj');
});

test('a stream keyword followed by CRLF starts the data after both bytes', () => {
  const v = one('<< /Length 5 >>\r\nstream\r\nhello\r\nendstream');
  assert.ok(v instanceof PdfStream);
  assert.deepEqual(Array.from(v.data), codes('hello'));
  const padded = one('<< /Length 5 >> \t\nstream\r\nhello\nendstream');
  assert.ok(padded instanceof PdfStream);
  assert.deepEqual(Array.from(padded.data), codes('hello'));
});

test('stream data is taken by Length even when it holds the endstream keyword or line ends', () => {
  const body = '\nab endstream cd\r\n';
  const l = lex(`<< /Length ${body.length} >>\nstream\n${body}\nendstream 3`);
  const v = l.value();
  assert.ok(v instanceof PdfStream);
  assert.deepEqual(Array.from(v.data), codes(body));
  assert.equal(l.value(), 3);
});

test('an indirect Length is resolved through the callback', () => {
  const seen: PdfRef[] = [];
  const body = 'x endstream y';
  const l = new Lexer(raw(`<< /Length 7 0 R >>\nstream\n${body}\nendstream`), 0, (r) => {
    seen.push(r);
    return body.length;
  });
  const v = l.value();
  assert.ok(v instanceof PdfStream);
  assert.equal(latin1(v.data), body);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].num, 7);
});

test('a wrong or missing Length falls back to the endstream keyword', () => {
  const a = one('<< /Length 99 >>\nstream\nhello\nendstream');
  assert.ok(a instanceof PdfStream);
  assert.equal(latin1(a.data), 'hello');
  const b = one('<< /Length 2 >>\nstream\nhello\r\nendstream');
  assert.ok(b instanceof PdfStream);
  assert.equal(latin1(b.data), 'hello');
  const c = one('<< >>\nstream\nhello\nendstream');
  assert.ok(c instanceof PdfStream);
  assert.equal(latin1(c.data), 'hello');
});

test('a stream without endstream raises PdfError', () => {
  assert.throws(() => one('<< /Length 5 >>\nstream\nhello'), PdfError);
  assert.throws(() => one('<< /Length 5 >>\nstream\n'), PdfError);
});

test('empty and truncated containers raise PdfError', () => {
  assert.throws(() => one(''), PdfError);
  assert.throws(() => one('  \n% only a comment'), PdfError);
  assert.throws(() => one('[1 2'), PdfError);
  assert.throws(() => one('[1 [2]'), PdfError);
  assert.throws(() => one('<< /A 1'), PdfError);
  assert.throws(() => one('<< /A'), PdfError);
  assert.throws(() => one('<<'), PdfError);
  assert.throws(() => one('<< 1 2 >>'), PdfError);
  assert.throws(() => one('<< (k) 2 >>'), PdfError);
});

test('an unterminated literal string raises PdfError', { todo: 'defect: a literal string cut off before its closing parenthesis is returned as a string, a trailing backslash adds a zero byte' }, () => {
  assert.throws(() => one('(abc'), PdfError);
  assert.throws(() => one('(a (b) c'), PdfError);
  assert.throws(() => one('(abc\\'), PdfError);
});

test('an unterminated hex string raises PdfError', { todo: 'defect: a hex string cut off before its closing bracket is returned as a string' }, () => {
  assert.throws(() => one('<4869'), PdfError);
  assert.throws(() => one('<'), PdfError);
});

test('stray closing delimiters raise PdfError', { todo: 'defect: a stray ) ] > or } where a value is expected is read as null' }, () => {
  assert.throws(() => one(')'), PdfError);
  assert.throws(() => one(']'), PdfError);
  assert.throws(() => one('>>'), PdfError);
  assert.throws(() => one('}'), PdfError);
});

test('malformed numbers raise PdfError', { todo: 'defect: tokens such as 1.2.3, +-5 and a lone sign are read as 0, and 0x10 and 6.02E23 are accepted as numbers' }, () => {
  assert.throws(() => one('1.2.3'), PdfError);
  assert.throws(() => one('+-5'), PdfError);
  assert.throws(() => one('-'), PdfError);
  assert.throws(() => one('0x10'), PdfError);
  assert.throws(() => one('6.02E23'), PdfError);
});

test('very deep array nesting raises PdfError and not a stack overflow', { todo: 'defect: 200000 nested arrays overflow the call stack and raise RangeError, there is no depth limit' }, () => {
  assert.throws(() => one('['.repeat(200000)), PdfError);
});

test('random garbage always ends and each call moves forward or raises PdfError', () => {
  const alphabet = '()<>[]{}/%\\ \n\r\t\x00\f0123456789+-.#RtfnAaZstreamendobj\xff';
  let seed = 0x2545f491;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed;
  };
  for (let round = 0; round < 400; round++) {
    const len = 1 + (rnd() % 60);
    let s = '';
    for (let i = 0; i < len; i++) s += alphabet[rnd() % alphabet.length];
    const l = lex(s);
    let calls = 0;
    while (l.pos < len) {
      const before = l.pos;
      try {
        l.value();
      } catch (e) {
        assert.ok(e instanceof PdfError, `input ${JSON.stringify(s)} raised ${String(e)}`);
      }
      assert.ok(l.pos > before, `no progress at ${before} in ${JSON.stringify(s)}`);
      assert.ok(l.pos <= len, `position ran past the end in ${JSON.stringify(s)}`);
      assert.ok(++calls <= len, `too many calls for ${JSON.stringify(s)}`);
    }
  }
});

test('word and peekWord read a keyword and only word consumes it', () => {
  const l = lex('  % c\n obj<<');
  assert.equal(l.peekWord(), 'obj');
  assert.equal(l.pos, 0);
  assert.equal(l.word(), 'obj');
  assert.equal(l.pos, 10);
  assert.equal(l.word(), '');
  assert.deepEqual(new Lexer(raw('garbage 5 0 R'), 8).value(), new PdfRef(5, 0));
  assert.equal(latin1(raw('abcdef'), 2, 4), 'cd');
  assert.equal(latin1(raw('abcdef'), 4), 'ef');
  assert.equal(latin1(raw('abc'), 1, 1), '');
});

test('latin1 round trips all 256 byte values and buffers past the chunk size', () => {
  const big = new Uint8Array(0x8000 * 2 + 17);
  for (let i = 0; i < big.length; i++) big[i] = (i * 7) & 0xff;
  const text = latin1(big);
  assert.equal(text.length, big.length);
  assert.deepEqual(fromLatin1(text), big);
  assert.equal(latin1(big, 0x7fff, 0x8002), String.fromCharCode(big[0x7fff], big[0x8000], big[0x8001]));
  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i++) all[i] = i;
  const s = latin1(all);
  assert.equal(s.length, 256);
  for (let i = 0; i < 256; i++) assert.equal(s.charCodeAt(i), i);
  assert.deepEqual(fromLatin1(s), all);
});

test('indexOf finds matches at the start, the end and from an offset', () => {
  const hay = raw('abcXYZabc');
  assert.equal(indexOf(hay, raw('abc')), 0);
  assert.equal(indexOf(hay, raw('abc'), 1), 6);
  assert.equal(indexOf(hay, raw('XYZ')), 3);
  assert.equal(indexOf(hay, raw('c'), 8), 8);
  assert.equal(indexOf(hay, hay), 0);
  assert.equal(indexOf(hay, raw('abd')), -1);
  assert.equal(indexOf(hay, raw('abc'), 7), -1);
  assert.equal(indexOf(hay, raw('bcd')), -1);
  assert.equal(indexOf(hay, raw('abcXYZabcd')), -1);
  assert.equal(indexOf(new Uint8Array(0), raw('a')), -1);
  assert.equal(indexOf(raw('aaab'), raw('aab')), 1);
  assert.equal(indexOf(raw('aaaa'), raw('aa')), 0);
  assert.equal(indexOf(raw('aaaa'), raw('aa'), 1), 1);
  assert.equal(indexOf(raw('aaaa'), raw('aa'), 3), -1);
  assert.equal(indexOf(raw('ababac'), raw('abac')), 2);
});

test('lastIndexOf finds the last match at the start, the end and before an offset', () => {
  const hay = raw('abcXYZabc');
  assert.equal(lastIndexOf(hay, raw('abc')), 6);
  assert.equal(lastIndexOf(hay, raw('abc'), 5), 0);
  assert.equal(lastIndexOf(hay, raw('abcX')), 0);
  assert.equal(lastIndexOf(hay, raw('XYZ')), 3);
  assert.equal(lastIndexOf(hay, raw('abc'), 100), 6);
  assert.equal(lastIndexOf(raw('abcXYZabc'), raw('abd')), -1);
  assert.equal(lastIndexOf(raw('ab'), raw('abc')), -1);
  assert.equal(lastIndexOf(raw('xabc'), raw('abc'), 0), -1);
  assert.equal(lastIndexOf(raw('aaaa'), raw('aa')), 2);
  assert.equal(lastIndexOf(raw('aaaa'), raw('aa'), 1), 1);
  assert.equal(lastIndexOf(raw('baab'), raw('aab')), 1);
});

test('name isName and dict build and test object values', () => {
  const n = name('Type');
  assert.ok(n instanceof PdfName);
  assert.equal(n.name, 'Type');
  assert.equal(isName(n), true);
  assert.equal(isName(n, 'Type'), true);
  assert.equal(isName(n, 'Other'), false);
  assert.equal(isName('Type'), false);
  assert.equal(isName(null), false);
  assert.equal(isName(new PdfString(raw('Type')), 'Type'), false);
  const d = dict({ A: 1, B: n });
  assert.ok(d instanceof PdfDict);
  assert.equal(d.get('A'), 1);
  assert.equal(d.get('B'), n);
  assert.equal(new PdfRef(4).gen, 0);
  assert.ok(new PdfError('x') instanceof Error);
});

test('PdfDict set get has delete and clone behave like a map', () => {
  const d = new PdfDict();
  assert.equal(d.set('A', 1), d);
  d.set('B', null);
  assert.equal(d.has('A'), true);
  assert.equal(d.has('B'), true);
  assert.equal(d.get('B'), null);
  assert.equal(d.has('C'), false);
  assert.equal(d.get('C'), undefined);
  const c = d.clone();
  c.set('A', 2);
  c.delete('B');
  assert.equal(d.get('A'), 1);
  assert.equal(d.has('B'), true);
  assert.equal(c.get('A'), 2);
  assert.equal(c.has('B'), false);
  d.delete('A');
  assert.equal(d.has('A'), false);
});

test('nameText escapes delimiters, the number sign, white space and bytes outside printable ASCII', () => {
  assert.equal(nameText('Type'), '/Type');
  assert.equal(nameText(''), '/');
  assert.equal(nameText('Lime Green'), '/Lime#20Green');
  assert.equal(nameText('a#b'), '/a#23b');
  assert.equal(nameText('a(b)/c%'), '/a#28b#29#2fc#25');
  assert.equal(nameText('é\x00'), '/#e9#00');
  for (const n of ['A B', 'x#41', '()<>[]{}/%', '\x00\t\n\f\r \x7f\xff', '']) {
    const back = one(nameText(n) + ' 1');
    assert.ok(back instanceof PdfName);
    assert.equal(back.name, n);
  }
});

test('numText writes integers and reals in plain decimal form', () => {
  assert.equal(numText(0), '0');
  assert.equal(numText(-42), '-42');
  assert.equal(numText(1.5), '1.5');
  assert.equal(numText(-0.25), '-0.25');
  assert.equal(numText(0.1 + 0.2), '0.3');
  assert.equal(numText(-0.00001), '0');
  assert.equal(numText(1e-7), '0');
  assert.match(numText(123456789.5), /^\d+\.\d+$/);
});

test('numText never writes exponent notation for large values', { todo: 'defect: numText(1e21) writes 1e+21, PDF numbers have no exponent form' }, () => {
  assert.match(numText(1e21), /^\d+$/);
  assert.match(numText(1.5e22), /^\d+$/);
});

test('stringText writes literal or hex form that reads back to the same bytes', () => {
  assert.equal(stringText(new PdfString(raw('abc'))), '(abc)');
  assert.equal(stringText(new PdfString(raw('a(b)\\'))), '(a\\(b\\)\\\\)');
  assert.equal(stringText(new PdfString(raw('AB'), true)), '<4142>');
  assert.equal(stringText(new PdfString(Uint8Array.from([0, 10, 255]))), '<000aff>');
  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i++) all[i] = i;
  for (const bytes of [all, raw('((('), raw(')\\('), raw('\\101'), new Uint8Array(0)]) {
    const back = one(stringText(new PdfString(bytes)));
    assert.ok(back instanceof PdfString);
    assert.deepEqual(back.bytes, bytes);
  }
});

test('ByteWriter joins text and bytes in order and tracks the length', () => {
  const w = new ByteWriter();
  w.text('abÿ');
  w.bytes(Uint8Array.from([0, 1]));
  w.text('c');
  assert.equal(w.length, 6);
  assert.deepEqual(Array.from(w.done()), [97, 98, 255, 0, 1, 99]);
  const big = new ByteWriter();
  const chunk = 'x'.repeat(50000);
  big.text(chunk);
  big.text('y'.repeat(50000));
  const out = big.done();
  assert.equal(out.length, 100000);
  assert.equal(big.length, 100000);
  assert.equal(out[49999], 120);
  assert.equal(out[50000], 121);
  assert.equal(out[99999], 121);
});

test('writeValue output reads back to the same structure', () => {
  const data = Uint8Array.from([0, 10, 13, 255, 101, 110, 100]);
  const inner = dict({ Kids: [new PdfRef(3, 0), new PdfRef(4, 1)], 'My Key': name('A B'), N: null });
  const v: PdfValue = [
    1,
    -2.5,
    true,
    false,
    null,
    name('Font'),
    new PdfString(raw('hi (there)')),
    new PdfString(Uint8Array.from([1, 2, 254]), true),
    new PdfRef(9, 2),
    inner,
    [[], dict({})],
    new PdfStream(dict({ Filter: name('None'), Length: 999 }), data),
  ];
  const w = new ByteWriter();
  writeValue(w, v, (r) => r);
  const back = new Lexer(w.done()).value() as PdfValue[];
  assert.equal(back.length, 12);
  assert.deepEqual(back.slice(0, 5), [1, -2.5, true, false, null]);
  assert.ok(isName(back[5], 'Font'));
  assert.deepEqual(Array.from((back[6] as PdfString).bytes), codes('hi (there)'));
  assert.deepEqual(Array.from((back[7] as PdfString).bytes), [1, 2, 254]);
  assert.deepEqual(back[8], new PdfRef(9, 2));
  const d = back[9] as PdfDict;
  assert.ok(d instanceof PdfDict);
  assert.deepEqual(d.get('Kids'), [new PdfRef(3, 0), new PdfRef(4, 1)]);
  assert.ok(isName(d.get('My Key'), 'A B'));
  assert.equal(d.has('N'), true);
  assert.equal(d.get('N'), null);
  const nested = back[10] as PdfValue[];
  assert.deepEqual(nested[0], []);
  assert.ok(nested[1] instanceof PdfDict);
  const s = back[11] as PdfStream;
  assert.ok(s instanceof PdfStream);
  assert.deepEqual(s.data, data);
  assert.equal(s.dict.get('Length'), data.length);
  assert.ok(isName(s.dict.get('Filter'), 'None'));
  const mapped = new ByteWriter();
  writeValue(mapped, [new PdfRef(1, 0), new PdfRef(2, 0), 5], (r) => (r.num === 1 ? new PdfRef(10, 3) : null));
  assert.equal(latin1(mapped.done()), '[10 3 R null 5]');
});

test('visitRefs reaches references in arrays, dictionaries and stream dictionaries', () => {
  const seen: number[] = [];
  const v: PdfValue = [
    new PdfRef(1),
    dict({ A: new PdfRef(2), B: [new PdfRef(3), 7, name('X')] }),
    new PdfStream(dict({ Length: new PdfRef(4), P: dict({ Q: new PdfRef(5) }) }), new Uint8Array(0)),
    new PdfString(raw('6 0 R')),
    null,
  ];
  visitRefs(v, (r) => seen.push(r.num));
  assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5]);
  visitRefs(undefined, () => assert.fail('no reference expected'));
  visitRefs(12, () => assert.fail('no reference expected'));
});
