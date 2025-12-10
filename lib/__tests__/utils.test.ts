import { cn, isTextExtractable } from '@/lib/utils';

describe('cn helper', () => {
  it('merges conditional class names', () => {
    const condition = false;
    const result = cn('base', condition && 'hidden', ['flex', 'items-center']);
    expect(result).toBe('base flex items-center');
  });
});

describe('isTextExtractable', () => {
  it('returns true for supported Office mime types', () => {
    expect(isTextExtractable('application/msword')).toBe(true);
    expect(isTextExtractable('application/vnd.ms-powerpoint')).toBe(true);
  });

  it('returns false for unsupported types', () => {
    expect(isTextExtractable('application/pdf')).toBe(false);
    expect(isTextExtractable('image/png')).toBe(false);
  });
});
