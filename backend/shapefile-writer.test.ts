import { describe, expect, it } from 'vitest';

import { buildShpAndShx, geojsonToShpRecords, ringSignedArea } from './shapefile-writer';

describe('geojsonToShpRecords', () => {
  it('preserves the orientation of centimetric rings at real geographic coordinates', () => {
    const tinyCounterClockwise = [
      [-52.473476, -12.268692],
      [-52.47347599, -12.268692],
      [-52.47347599, -12.26869199],
      [-52.473476, -12.26869199],
      [-52.473476, -12.268692],
    ];

    // This used to collapse to exactly zero because products around 640 were
    // subtracted to recover an area around 1e-16 square degrees.
    expect(Math.abs(ringSignedArea(tinyCounterClockwise))).toBeGreaterThan(0);
    const [record] = geojsonToShpRecords(
      { type: 'Polygon', coordinates: [tinyCounterClockwise] },
      { ID: 1 },
    );
    expect(ringSignedArea(record.rings[0])).toBeGreaterThan(0); // Shapefile shell = CW
  });

  it('creates one shapefile record per MultiPolygon polygon and repeats the AIR identification on all records', () => {
    const geometry = {
      type: 'MultiPolygon',
      coordinates: [
        [[
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ]],
        [[
          [2, 2],
          [3, 2],
          [3, 3],
          [2, 3],
          [2, 2],
        ]],
      ],
    };

    const records = geojsonToShpRecords(geometry, { ID: 1, IDENTIFIC: 'AIR-123' });

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.attributes.ID)).toEqual([1, 1]);
    expect(records.map((record) => record.attributes.IDENTIFIC)).toEqual(['AIR-123', 'AIR-123']);
    expect(records.every((record) => record.type === 'polygon')).toBe(true);
    expect(records.every((record) => record.rings.length === 1)).toBe(true);
  });

  it('writes MultiPolygon ATP as separate polygon records instead of one corrupt multi-part record', () => {
    const records = geojsonToShpRecords(
      {
        type: 'MultiPolygon',
        coordinates: [
          [[
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ]],
          [[
            [2, 2],
            [3, 2],
            [3, 3],
            [2, 3],
            [2, 2],
          ]],
        ],
      },
      { ID: 1 },
    );

    const { shp, shx } = buildShpAndShx(records);

    expect(records).toHaveLength(2);
    expect(shx.length).toBe(100 + records.length * 8);

    // First and second shape records must each be a standalone Polygon record
    // with one part. The old path collapsed a MultiPolygon into a single record,
    // making later polygons behave like malformed rings/holes in many GIS tools.
    expect(shp.readInt32BE(100)).toBe(1);
    expect(shp.readInt32LE(108)).toBe(5);
    expect(shp.readInt32LE(144)).toBe(1);

    const firstContentLengthBytes = shp.readInt32BE(104) * 2;
    const secondRecordOffset = 100 + 8 + firstContentLengthBytes;
    expect(shp.readInt32BE(secondRecordOffset)).toBe(2);
    expect(shp.readInt32LE(secondRecordOffset + 8)).toBe(5);
    expect(shp.readInt32LE(secondRecordOffset + 44)).toBe(1);
  });
});
