import { describe, expect, test } from 'bun:test';
import {
  ACCOUNT_ACCESS,
  ACCOUNT_ACCESS_KEY,
  OWNER_ACCESS,
  OWNER_ACCESS_KEY,
  SHEETS,
  hrefs,
  isNavActive,
  linkAccess,
  navSections,
  sheetLabel,
  toQuery,
} from './access';

const TOKEN = 'a'.repeat(48);

describe('workspace access', () => {
  test('link and owner access carry their base path and action key', () => {
    const link = linkAccess(TOKEN);
    expect(link).toEqual({ kind: 'link', token: TOKEN, key: TOKEN, basePath: `/s/${TOKEN}` });
    expect(OWNER_ACCESS).toEqual({ kind: 'owner', key: OWNER_ACCESS_KEY, basePath: '/admin' });
    // The owner key can never be mistaken for a token.
    expect(/^[0-9a-f]{48}$/i.test(OWNER_ACCESS_KEY)).toBe(false);
  });

  test('a branch account has its own base path and an action key that is never a token', () => {
    expect(ACCOUNT_ACCESS).toEqual({ kind: 'account', key: ACCOUNT_ACCESS_KEY, basePath: '/cabang' });
    expect(/^[0-9a-f]{48}$/i.test(ACCOUNT_ACCESS_KEY)).toBe(false);
    expect(ACCOUNT_ACCESS_KEY).not.toBe(OWNER_ACCESS_KEY);
    const links = hrefs(ACCOUNT_ACCESS);
    expect(links.dashboard).toBe('/cabang');
    expect(links.bmi).toBe('/cabang/bmi');
    expect(links.to('bmi', { periode: 2 })).toBe('/cabang/bmi?periode=2');
  });

  test('every sheet path hangs off the base path', () => {
    const owner = hrefs(OWNER_ACCESS);
    expect(owner.dashboard).toBe('/admin');
    expect(owner.trackerStaf).toBe('/admin/tracker-staf');
    expect(owner.rencanaAksi).toBe('/admin/rencana-aksi');
    const link = hrefs(linkAccess(TOKEN));
    expect(link.dashboard).toBe(`/s/${TOKEN}`);
    expect(link.laporanBulanan).toBe(`/s/${TOKEN}/laporan-bulanan`);
    expect(SHEETS.map((s) => s.label)).toEqual([
      'Beranda',
      'Laporan Bulanan',
      'Rencana Aksi',
      'Cek BMI',
      'Tracker Staf',
      'Penggantian SDM',
    ]);
    expect(owner.penggantian).toBe('/admin/penggantian');
    expect(sheetLabel('rencanaAksi')).toBe('Rencana Aksi');
  });

  test('navigation is grouped; a single station gets two pages; Pengelolaan only for owner', () => {
    const shape = (sections: ReturnType<typeof navSections>) =>
      sections.map((s) => [s.label, s.items.map((i) => i.label)]);

    expect(shape(navSections(linkAccess(TOKEN)))).toEqual([
      ['Pantau', ['Beranda', 'Laporan Bulanan']],
      ['Tindak lanjut', ['Rencana Aksi', 'Cek BMI']],
      ['Data SDM', ['Tracker Staf', 'Penggantian SDM']],
    ]);
    expect(shape(navSections(linkAccess(TOKEN), { branchOnly: true }))).toEqual([['Tindak lanjut', ['Rencana Aksi', 'Cek BMI']]]);
    expect(navSections(linkAccess(TOKEN)).flatMap((s) => s.items).find((i) => i.key === 'rencanaAksi')?.href).toBe(
      `/s/${TOKEN}/rencana-aksi`,
    );
    const owner = navSections(OWNER_ACCESS);
    expect(shape(owner).at(-1)).toEqual(['Pengelolaan', ['Tautan Akses', 'Akun Cabang', 'Parameter', 'Sinkronisasi']]);
    expect(owner.flatMap((s) => s.items).find((i) => i.key === 'akun')?.href).toBe('/admin/akun');
    // A KPS account gets the same pages as a KPS link, never the owner's Pengelolaan group.
    expect(shape(navSections(ACCOUNT_ACCESS))).toEqual(shape(navSections(linkAccess(TOKEN))));
    expect(navSections(ACCOUNT_ACCESS)[0].items[0].href).toBe('/cabang');
    const home = owner[0].items[0];
    expect(home).toMatchObject({ href: '/admin', exact: true, label: 'Beranda' });
    expect(owner[0].items[1].shortLabel).toBe('Laporan');
  });

  test('isNavActive: index pages match exactly, others match their children', () => {
    expect(isNavActive('/admin', { href: '/admin', exact: true })).toBe(true);
    expect(isNavActive('/admin/sdm', { href: '/admin', exact: true })).toBe(false);
    expect(isNavActive('/admin/sdm/x', { href: '/admin/sdm', exact: false })).toBe(true);
    expect(isNavActive('/admin/sdmx', { href: '/admin/sdm', exact: false })).toBe(false);
  });

  test('to() adds the query and hash, skipping empty values', () => {
    const links = hrefs(OWNER_ACCESS);
    expect(links.to('bmi', { periode: 2, stasiun: 'SUB' })).toBe('/admin/bmi?periode=2&stasiun=SUB');
    expect(links.to('rencanaAksi', { cabang: 'DPS', stasiun: null, tab: undefined, lp: false, cek: '' })).toBe(
      '/admin/rencana-aksi?cabang=DPS',
    );
    expect(links.to('rencanaAksi', undefined, 'ra-12')).toBe('/admin/rencana-aksi#ra-12');
    expect(links.to('dashboard')).toBe('/admin');
    expect(toQuery({ a: 'x y' })).toBe('?a=x+y');
  });
});
