import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_takeaways as bt  # noqa: E402

AUTH = b"""<?xml version="1.0" encoding="utf-8"?>
<ArrayOfWebLocalAuthorityAPI xmlns="http://schemas.datacontract.org/2004/07/FHRS.Model.WebAPI" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
<WebLocalAuthorityAPI><LocalAuthorityId>1</LocalAuthorityId><LocalAuthorityIdCode></LocalAuthorityIdCode><Name>All</Name><FileName></FileName><RegionName></RegionName></WebLocalAuthorityAPI>
<WebLocalAuthorityAPI><LocalAuthorityId>196</LocalAuthorityId><LocalAuthorityIdCode>521</LocalAuthorityIdCode><Name>Kingston-Upon-Thames</Name><FriendlyName>kingston-upon-thames</FriendlyName><FileName>http://x/FHRS521en-GB.xml</FileName><RegionName>London</RegionName></WebLocalAuthorityAPI>
<WebLocalAuthorityAPI><LocalAuthorityId>9</LocalAuthorityId><LocalAuthorityIdCode>551</LocalAuthorityIdCode><Name>Cardiff</Name><FriendlyName>cardiff</FriendlyName><FileName>http://x/FHRS551en-GB.xml</FileName><RegionName>Wales</RegionName></WebLocalAuthorityAPI>
</ArrayOfWebLocalAuthorityAPI>"""

EST = b"""<?xml version="1.0" encoding="utf-8"?>
<FHRSEstablishment><Header><ExtractDate>2026-10-08</ExtractDate><ItemCount>3</ItemCount></Header><EstablishmentCollection>
<EstablishmentDetail><FHRSID>1386206</FHRSID><BusinessName>Ace Kebabs</BusinessName><BusinessType>Takeaway/sandwich shop</BusinessType><BusinessTypeID>7844</BusinessTypeID>
<AddressLine1>12 Clarence Street</AddressLine1><AddressLine3>Kingston upon Thames</AddressLine3><PostCode>KT1 1NY</PostCode><RatingValue>5</RatingValue><RatingDate>2024-03-01T00:00:00</RatingDate>
<Geocode><Longitude>-0.30412</Longitude><Latitude>51.41023</Latitude></Geocode></EstablishmentDetail>
<EstablishmentDetail><FHRSID>2</FHRSID><BusinessName>A Cafe</BusinessName><BusinessTypeID>1</BusinessTypeID><Geocode><Longitude>-0.3</Longitude><Latitude>51.4</Latitude></Geocode></EstablishmentDetail>
<EstablishmentDetail><FHRSID>4</FHRSID><BusinessName>Kingston Fried Chicken</BusinessName><BusinessTypeID>1</BusinessTypeID><Geocode><Longitude>-0.301</Longitude><Latitude>51.409</Latitude></Geocode></EstablishmentDetail>
<EstablishmentDetail><FHRSID>3</FHRSID><BusinessName>No Location Chicken</BusinessName><BusinessTypeID>7844</BusinessTypeID><Geocode /></EstablishmentDetail>
</EstablishmentCollection></FHRSEstablishment>"""


class Tests(unittest.TestCase):
    def test_authorities_skip_summary_rows(self):
        a = bt.parse_authorities(AUTH)
        self.assertEqual([x["LocalAuthorityIdCode"] for x in a], ["521", "551"])
        self.assertEqual(a[0]["RegionName"], "London")

    def test_takeaways_only_with_location(self):
        rows, extract = bt.parse_takeaways(EST)
        self.assertEqual(extract, "2026-10-08")
        self.assertEqual([r[1] for r in rows], ["Ace Kebabs", "Kingston Fried Chicken"])
        self.assertEqual([r[8] for r in rows], ["t", "r"])
        self.assertEqual(rows[0][2], "12 Clarence Street, Kingston upon Thames")
        self.assertEqual(rows[0][4:6], [51.41023, -0.30412])
        self.assertEqual(rows[0][7], "2024-03-01")

    def test_kind(self):
        self.assertEqual(bt.kind_of("7844", "Greggs"), "t")
        self.assertEqual(bt.kind_of("1", "Dixy Chicken"), "r")
        self.assertEqual(bt.kind_of("1", "Pizza Palace"), "r")
        self.assertEqual(bt.kind_of("1", "Mama's Kitchen Cafe"), None)
        self.assertEqual(bt.kind_of("5", "Chicken Farm"), None)

    def test_bbox_ignores_outliers(self):
        rows = [[0, "", "", "", 51.40 + i / 10000, -0.30, "", "", "t"] for i in range(100)]
        rows.append([0, "", "", "", 55.0, -3.0, "", "", "t"])  # badly geocoded
        w, s_, e, n = bt.bbox(rows)
        self.assertLess(n, 51.5)
        self.assertGreater(w, -0.31)


if __name__ == "__main__":
    unittest.main()
