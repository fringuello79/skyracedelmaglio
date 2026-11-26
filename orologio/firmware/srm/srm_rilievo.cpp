#include "srm_rilievo.h"
#include <algorithm>
#include <cmath>

namespace srm
{

// fasce di quota (scure: sopra ci vanno percorso e scritte) per la luce da nord-ovest
static constexpr uint16_t c565(int r, int g, int b)
{
    return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}
static constexpr int FASCE[8][3] = {{20, 40, 26}, {26, 46, 28}, {36, 50, 28}, {48, 52, 30},
                                    {58, 52, 36}, {66, 58, 46}, {72, 68, 62}, {84, 84, 88}};
static constexpr int luce(int v, int l)
{
    // l = 0..15: dal versante in ombra a quello al sole
    return v * (40 + l * 8) / 100 > 255 ? 255 : v * (40 + l * 8) / 100;
}
static constexpr uint16_t colore(int i)
{
    return i == 128   ? c565(104, 88, 60)
           : i == 129 ? c565(150, 128, 86)
                      : c565(luce(FASCE[i / 16][0], i % 16), luce(FASCE[i / 16][1], i % 16), luce(FASCE[i / 16][2], i % 16));
}
#define R8(n) colore(n), colore(n + 1), colore(n + 2), colore(n + 3), colore(n + 4), colore(n + 5), colore(n + 6), colore(n + 7)
const uint16_t Rilievo::TAVOLOZZA[Rilievo::N_COLORI] = {R8(0),  R8(8),  R8(16), R8(24), R8(32),  R8(40),  R8(48),  R8(56),      R8(64),
                                                        R8(72), R8(80), R8(88), R8(96), R8(104), R8(112), R8(120), colore(128), colore(129)};
#undef R8

void Rilievo::calcola(const Terreno &t, double lat, double lon, double mpp, int cx, int cy, int y0, int larg, int alt, int scala,
                      int curve)
{
    if (lat == kLat && lon == kLon && mpp == kMpp && cx == kCx && cy == kCy && y0 == kY0 && larg == kLarg && alt == kAlt &&
        scala == kScala && curve == kCurve && !buf.empty())
        return;
    kLat = lat, kLon = lon, kMpp = mpp, kCx = cx, kCy = cy, kY0 = y0, kLarg = larg, kAlt = alt, kScala = scala, kCurve = curve;
    w = (larg + scala - 1) / scala;
    h = (alt + scala - 1) / scala;
    buf.assign((size_t)w * h, 0);
    const double kCos = std::cos(lat * 3.14159265358979323846 / 180);
    const double cella = mpp * scala; // metri fra due indici vicini
    // colonna e riga della griglia delle quote per il primo indice, e passo: tutto lineare.
    // Nel ciclo solo numeri a precisione singola: l'orologio i «double» li calcola via software, lentamente.
    const double lonSx = lon + ((scala / 2.0) - cx) * mpp / (kCos * 111320);
    const double latSu = lat - ((y0 + scala / 2.0) - cy) * mpp / 110540;
    const float u0 = (float)((lonSx - t.lon0) / t.dlon), du = (float)(cella / (kCos * 111320) / t.dlon);
    const float v0 = (float)((latSu - t.lat0) / t.dlat), dv = (float)(-cella / 110540 / t.dlat);
    const float perMetroX = 1.7f / (float)(t.dlon * kCos * 111320), perMetroY = 1.7f / (float)(t.dlat * 110540); // rilievo accentuato
    const float FUORI = -10000.0f, invCurve = 1.0f / curve;
    const int nx = t.nx;
    // quota interpolata fra le quattro quote intorno
    auto rigaQuote = [&](float v, std::vector<float> &out) {
        int j = (int)v;
        bool rigaOk = v >= 1 && j < t.ny - 2;
        float fv = v - j;
        const int16_t *r0 = t.q + (size_t)(rigaOk ? j : 0) * nx, *r1 = r0 + nx;
        for (int i = 0; i <= w; i++) {
            float u = u0 + i * du;
            int c = (int)u;
            if (!rigaOk || u < 1 || c >= nx - 2) {
                out[i] = FUORI;
                continue;
            }
            float fu = u - c, a = r0[c] + (r0[c + 1] - r0[c]) * fu, b = r1[c] + (r1[c + 1] - r1[c]) * fu;
            out[i] = a + (b - a) * fv;
        }
    };
    std::vector<float> sopra(w + 1), sotto(w + 1);
    rigaQuote(v0, sopra);
    static const float RETINO[4] = {-0.375f, 0.125f, 0.375f, -0.125f}; // nasconde i gradini fra un livello di luce e l'altro
    for (int j = 0; j < h; j++) {
        const float v = v0 + j * dv;
        rigaQuote(v + dv, sotto);
        uint8_t *riga = buf.data() + (size_t)j * w;
        const int jj = (int)v;
        const float fv = v - jj;
        const int16_t *r = t.q + (size_t)std::max(1, std::min(t.ny - 3, jj)) * nx; // righe jj-1 .. jj+2 esistono
        for (int i = 0; i < w; i++) {
            float q = sopra[i], est = sopra[i + 1], sud = sotto[i];
            if (q < -5000 || est < -5000 || sud < -5000) {
                riga[i] = 4; // senza quote: tinta unita scura
                continue;
            }
            int c = (int)std::floor(q * invCurve), ce = (int)std::floor(est * invCurve), cs = (int)std::floor(sud * invCurve);
            if (c != ce || c != cs) {
                int livello = std::max(c, std::max(ce, cs)) * curve;
                riga[i] = livello % (curve * 5) == 0 ? 129 : 128;
                continue;
            }
            // pendenza: calcolata sui nodi della griglia (differenze centrate) e interpolata, così la luce cambia in
            // modo continuo anche quando la mappa è molto ingrandita (fra due quote ci sono decine di pixel)
            const float u = u0 + i * du;
            const int k = (int)u;
            const float fu = u - k;
            const int16_t *p = r + k; // nodo in basso a sinistra (sud-ovest); +nx = una riga più a nord
            float gx00 = p[1] - p[-1], gx10 = p[2] - p[0], gx01 = p[nx + 1] - p[nx - 1], gx11 = p[nx + 2] - p[nx];
            float gy00 = p[nx] - p[-nx], gy10 = p[nx + 1] - p[1 - nx], gy01 = p[2 * nx] - p[0], gy11 = p[2 * nx + 1] - p[1];
            float gxa = gx00 + (gx10 - gx00) * fu, gxb = gx01 + (gx11 - gx01) * fu;
            float gya = gy00 + (gy10 - gy00) * fu, gyb = gy01 + (gy11 - gy01) * fu;
            float gx = (gxa + (gxb - gxa) * fv) * 0.5f * perMetroX; // salita verso est
            float gy = (gya + (gyb - gya) * fv) * 0.5f * perMetroY; // salita verso nord
            // luce da nord-ovest, a 45 gradi: più chiaro il versante rivolto a nord-ovest
            float inv = 1.0f / std::sqrt(gx * gx + gy * gy + 1.0f);
            float lum = (gx - gy + 1.0f) * inv * 0.57735f; // 0.577 in piano
            int l = (int)std::floor((lum - 0.577f) * 16.0f + 7.5f + RETINO[(i & 1) + 2 * (j & 1)]);
            l = std::max(0, std::min(15, l));
            int f = std::max(0, std::min(7, ((int)q - 600) / 250));
            riga[i] = (uint8_t)(f * 16 + l);
        }
        sopra.swap(sotto);
    }
}

} // namespace srm
