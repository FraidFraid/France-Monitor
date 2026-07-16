import { describe, expect, it } from 'vitest';

import { buildLatestGibsViirsTileUrl } from './gibs-imagery.ts';

describe('buildLatestGibsViirsTileUrl', () => {
  it('uses the NASA GIBS latest-available resource instead of a fragile fixed date', () => {
    expect(buildLatestGibsViirsTileUrl()).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
      + 'VIIRS_SNPP_CorrectedReflectance_TrueColor/default/'
      + 'GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg',
    );
  });
});
