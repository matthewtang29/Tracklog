// sample-library.js: an invented library (fake artists and play counts) so the
// page has something to show before anyone uploads their own file.

export function sampleLibrary() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const artists = [
    ["The Paper Lanterns", "Alternative"], ["Juniper Vale", "Pop"], ["Low Tide Radio", "Indie Rock"], ["Marisol Okafor", "R&B/Soul"],
    ["Static Orchard", "Alternative"], ["Kenji & the Kites", "Indie Pop"], ["Velvet Hours", "R&B/Soul"], ["North Ferry", "Rock"],
    ["Ada Quill", "Singer/Songwriter"], ["DJ Halfmoon", "Electronic"], ["Brass Cartography", "Jazz"], ["Mono Coast", "Hip-Hop/Rap"],
    ["Sunday Arcade", "Pop"], ["Field Notes", "Alternative"], ["Ruby Glass", "Pop"], ["The Long Weekends", "Indie Rock"]
  ];
  const words = ["Glow", "Harbour", "Paper", "Late", "Window", "Summer", "Static", "Orbit", "Honey", "Signal", "Northbound", "Ceiling", "Porch", "Neon", "Quiet", "Echo", "Driveway", "Polaroid", "Sidewalk", "Fever", "Kite", "Tide", "Velvet", "Cinema"];
  const ends = ["Light", "Song", "Again", "Hours", "Blue", "Lines", "Talk", "Weather", "Room", "Dream", "Season", "Club", "Shoes", "Hearts"];
  const tracks = {}; let id = 1000;
  const exportAt = new Date(Date.UTC(2026, 9, 20));
  const iso = (d) => d.toISOString().slice(0, 19).replace("T", " ");
  artists.forEach(([name, genre], ai) => {
    const fame = Math.pow(1 - ai / artists.length, 2.2);
    const albumCount = 1 + Math.floor(rnd() * 2);
    for (let al = 0; al < albumCount; al++) {
      const album = words[Math.floor(rnd() * words.length)] + " " + ends[Math.floor(rnd() * ends.length)];
      const n = 4 + Math.floor(rnd() * 7);
      for (let k = 0; k < n; k++) {
        const added = new Date(exportAt - (60 + rnd() * 640) * 864e5);
        const plays = rnd() < 0.18 ? 0 : Math.floor(fame * 180 * Math.pow(rnd(), 1.6) + rnd() * 12);
        const stale = rnd() < 0.18;
        const last = plays ? new Date(exportAt - (stale ? 200 + rnd() * 200 : rnd() * 50) * 864e5) : null;
        id++;
        tracks[id] = {
          "Track ID": id, "Persistent ID": "S" + id, Name: words[Math.floor(rnd() * words.length)] + " " + ends[Math.floor(rnd() * ends.length)],
          Artist: name, Album: album, Genre: genre, Kind: "Apple Music AAC audio file", "Total Time": Math.floor(150000 + rnd() * 140000),
          Year: 2016 + Math.floor(rnd() * 10), "Date Added": iso(added), "Play Count": plays, "Skip Count": Math.floor(rnd() * rnd() * 14),
          "Play Date UTC": last ? iso(last) : undefined, Loved: rnd() < 0.08
        };
      }
    }
  });
  const ids = Object.keys(tracks).map(Number);
  const pick = (m) => ids.filter(() => rnd() < m).map((i) => ({ "Track ID": i }));
  const Playlists = [
    { Name: "Library", Master: true },
    { Name: "Night drive", "Playlist Persistent ID": "P1", "Playlist Items": pick(0.35) },
    { Name: "Study focus", "Playlist Persistent ID": "P2", "Playlist Items": pick(0.2) },
    { Name: "Gym", "Playlist Persistent ID": "P3", "Playlist Items": pick(0.12) },
    { Name: "Rainy Sunday", "Playlist Persistent ID": "P4", "Playlist Items": pick(0.1) }
  ];
  return { Date: iso(exportAt), Tracks: tracks, Playlists };
}
