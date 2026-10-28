// sample-library.js: a demo library shown before anyone uploads their own.
// The songs are real (so cover art can be found), but every play count,
// skip count and date is invented.

const CATALOG = [
  ["Frank Ocean", "R&B/Soul", [
    ["Blonde", 2016, ["Pink + White", "Ivy", "Nights", "Self Control", "White Ferrari"]],
    ["channel ORANGE", 2012, ["Thinkin Bout You", "Pyramids"]],
  ]],
  ["Daniel Caesar", "R&B/Soul", [
    ["Freudian", 2017, ["Get You", "Best Part", "Hold Me Down", "Blessed"]],
  ]],
  ["SZA", "R&B/Soul", [
    ["SOS", 2022, ["Kill Bill", "Snooze", "Good Days"]],
    ["Ctrl", 2017, ["Love Galore", "The Weekend"]],
  ]],
  ["Tyler, The Creator", "Hip-Hop/Rap", [
    ["Flower Boy", 2017, ["See You Again", "911 / Mr. Lonely", "Garden Shed"]],
    ["IGOR", 2019, ["EARFQUAKE", "A BOY IS A GUN*"]],
  ]],
  ["Kendrick Lamar", "Hip-Hop/Rap", [
    ["DAMN.", 2017, ["HUMBLE.", "LOVE. FEAT. ZACARI."]],
    ["good kid, m.A.A.d city", 2012, ["Money Trees"]],
  ]],
  ["Steve Lacy", "R&B/Soul", [
    ["Gemini Rights", 2022, ["Bad Habit", "Helmet", "Static"]],
  ]],
  ["Clairo", "Alternative", [
    ["Immunity", 2019, ["Sofia", "Bags", "North"]],
    ["Sling", 2021, ["Amoeba", "Blouse"]],
  ]],
  ["The Strokes", "Alternative", [
    ["Is This It", 2001, ["Someday", "Last Nite"]],
    ["Room on Fire", 2003, ["Reptilia"]],
  ]],
  ["Radiohead", "Alternative", [
    ["OK Computer", 1997, ["No Surprises", "Karma Police"]],
    ["In Rainbows", 2007, ["Weird Fishes / Arpeggi", "Nude"]],
  ]],
  ["Tame Impala", "Alternative", [
    ["Currents", 2015, ["The Less I Know the Better", "Let It Happen", "Eventually"]],
  ]],
  ["Faye Webster", "Alternative", [
    ["Atlanta Millionaires Club", 2019, ["Kingston", "Right Side of My Neck"]],
  ]],
  ["Laufey", "Pop", [
    ["Bewitched", 2023, ["From The Start", "Promise"]],
  ]],
  ["Bruno Mars", "Pop", [
    ["24K Magic", 2016, ["Finesse", "Versace on the Floor"]],
  ]],
  ["Phoebe Bridgers", "Alternative", [
    ["Punisher", 2020, ["Garden Song", "Kyoto", "Motion Sickness"]],
  ]],
  ["Mac DeMarco", "Alternative", [
    ["Salad Days", 2014, ["Chamber of Reflection", "Let Her Go"]],
  ]],
];

// Cover art for each sample album, looked up once from the iTunes Search API
// so the demo shows real covers instantly without making any requests.
const ART = "https://is1-ssl.mzstatic.com/image/thumb/";
const COVERS = {
  "Blonde": "Music115/v4/bb/45/68/bb4568f3-68cd-619d-fbcb-4e179916545d/BlondCover-Final.jpg",
  "channel ORANGE": "Music125/v4/04/f8/63/04f863fc-2852-604f-c910-a97ac069506b/12UMGIM40339.rgb.jpg",
  "Freudian": "Music211/v4/b6/cd/1a/b6cd1a5b-83af-a1e2-0ad7-ea530fcf2522/859722261219.jpg",
  "SOS": "Music122/v4/bd/3b/a9/bd3ba9fb-9609-144f-bcfe-ead67b5f6ab3/196589564931.jpg",
  "Ctrl": "Music124/v4/a2/bc/ad/a2bcad46-b389-4be1-8bac-5a0959b0b8e4/886446548449.jpg",
  "Flower Boy": "Music125/v4/fd/fd/8c/fdfd8c26-b8f9-4768-41d3-b24773250c65/886446605814.jpg",
  "IGOR": "Music125/v4/0c/06/05/0c060581-6242-6a2a-a677-20170f2cf8da/886447710180.jpg",
  "DAMN.": "Music112/v4/ab/16/ef/ab16efe9-e7f1-66ec-021c-5592a23f0f9e/17UMGIM88793.rgb.jpg",
  "good kid, m.A.A.d city": "Music122/v4/36/86/ec/3686ec99-dec4-0a01-8b74-2d8a9a0263a7/12UMGIM52988.rgb.jpg",
  "Gemini Rights": "Music221/v4/41/cf/77/41cf7744-535f-3679-0ca6-c1b8d3f98c8f/196874557266.jpg",
  "Immunity": "Music221/v4/f2/47/06/f24706bc-a90c-f730-bd8a-586ddde8af3e/829299184631.jpg",
  "Sling": "Music125/v4/77/62/4a/77624a46-f824-57bd-2cfa-f2808761724e/21UMGIM42676.rgb.jpg",
  "Is This It": "Features115/v4/ea/04/d4/ea04d45d-6f5d-ede6-fb64-71f3e6a6e62f/dj.ojkzzidd.jpg",
  "Room on Fire": "Music124/v4/f7/e9/2a/f7e92a48-0e20-8286-bbbf-80bd85fbb1af/mzi.gcledsjj.jpg",
  "OK Computer": "Music116/v4/07/60/ba/0760ba0f-148c-b18f-d0ff-169ee96f3af5/634904078164.png",
  "In Rainbows": "Music126/v4/dd/50/c7/dd50c790-99ac-d3d0-5ab8-e3891fb8fd52/634904032463.png",
  "Currents": "Music115/v4/a8/2e/b4/a82eb490-f30a-a321-461a-0383c88fec95/15UMGIM23316.rgb.jpg",
  "Atlanta Millionaires Club": "Music124/v4/79/85/4e/79854e3b-cdc6-104a-eb43-39f0b04d8a64/dj.vnuqzcui.jpg",
  "Bewitched": "Music126/v4/1f/de/6c/1fde6cb4-9703-c214-cdc6-8ecf7d0f0aa0/197189040030.jpg",
  "24K Magic": "Music125/v4/e3/47/a0/e347a0cc-87ce-5d05-d560-176c7d48f66e/075679904119.jpg",
  "Punisher": "Music115/v4/39/91/4f/39914f60-e9aa-4ae9-3962-44b0a5e5d570/656605150062.jpg",
  "Salad Days": "Music211/v4/e0/04/eb/e004eb2b-754f-4a76-9ecc-87d4eea2a327/cover.jpg",
};

export const sampleCover = (album) => COVERS[album] ? `${ART}${COVERS[album]}/300x300bb.jpg` : null;

export function sampleLibrary() {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const exportAt = new Date(Date.UTC(2026, 9, 20));
  const iso = (d) => d.toISOString().slice(0, 19).replace("T", " ");
  const tracks = {};
  let id = 1000;

  CATALOG.forEach(([artist, genre, albums], ai) => {
    const fame = Math.pow(1 - ai / CATALOG.length, 1.8);
    albums.forEach(([album, year, songs]) => {
      songs.forEach((name) => {
        id++;
        const added = new Date(exportAt - (40 + rnd() * 680) * 864e5);
        const plays = rnd() < 0.1 ? 0 : Math.floor(fame * 220 * Math.pow(rnd(), 1.4) + rnd() * 15);
        const stale = rnd() < 0.15;
        const last = plays ? new Date(exportAt - (stale ? 200 + rnd() * 220 : rnd() * 45) * 864e5) : null;
        tracks[id] = {
          "Track ID": id, "Persistent ID": "S" + id, Name: name, Artist: artist, "Album Artist": artist,
          Album: album, Year: year, Genre: genre, Kind: "Apple Music AAC audio file",
          "Total Time": Math.floor(150000 + rnd() * 160000), "Date Added": iso(added),
          "Play Count": plays, "Skip Count": Math.floor(rnd() * rnd() * 18),
          "Play Date UTC": last ? iso(last) : undefined, Loved: rnd() < 0.12,
        };
      });
    });
  });

  const ids = Object.keys(tracks).map(Number);
  const pick = (share) => ids.filter(() => rnd() < share).map((i) => ({ "Track ID": i }));
  return {
    Date: iso(exportAt),
    Tracks: tracks,
    Playlists: [
      { Name: "Library", Master: true },
      { Name: "Night drive", "Playlist Persistent ID": "P1", "Playlist Items": pick(0.4) },
      { Name: "Study focus", "Playlist Persistent ID": "P2", "Playlist Items": pick(0.25) },
      { Name: "Gym", "Playlist Persistent ID": "P3", "Playlist Items": pick(0.15) },
      { Name: "Rainy Sunday", "Playlist Persistent ID": "P4", "Playlist Items": pick(0.15) },
    ],
  };
}
