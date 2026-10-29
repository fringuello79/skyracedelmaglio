#include "SrmGuidaModule.h"
#ifdef SRM_GUIDA

#include "MeshService.h"
#include "NodeDB.h"
#include "PowerFSM.h"
#include "PowerStatus.h"
#include "configuration.h"
#include "gps/RTC.h"
#include "main.h"
#include "mesh/MeshTypes.h"
#include "srm_dati.h"
#include "srm_voce.h"
#include <cstring>

#if HAS_SCREEN
#include "graphics/Screen.h"
#include "graphics/ScreenFonts.h"
#include "graphics/TFTColorRegions.h"
#include <OLEDDisplay.h>
#endif
#ifdef HAS_I2S
#include "AudioThread.h"
#endif

SrmGuidaModule *srmGuidaModule;

// suoni brevi e diversi per tipo (RTTTL sull'altoparlante dell'orologio); la voce registrata arriverà dopo
static const char RT_PREAVVISO[] = "pre:d=16,o=6,b=180:c,e";
static const char RT_BIVIO[] = "biv:d=16,o=6,b=180:c,e,g";
static const char RT_ERRORE[] = "err:d=8,o=5,b=200:a,p,a,p,a";
static const char RT_POSITIVO[] = "ok:d=16,o=6,b=200:g,c7";
static const char RT_SOS[] = "sos:d=16,o=6,b=200:c,c,c,8p,8c,8c,8c,8p,c,c,c";

int SrmGuidaModule::pettoraleDaNome()
{
    // «SRM pettorale 057» → 57; altrimenti le ultime cifre del numero del nodo
    const char *n = owner.long_name;
    int v = -1;
    for (const char *c = n; *c; c++)
        if (*c >= '0' && *c <= '9')
            v = (v < 0 ? 0 : v) * 10 + (*c - '0');
        else if (v >= 0 && *c == ' ')
            v = -1;
    if (v < 0 && nodeDB)
        v = nodeDB->getNodeNum() % 1000;
    return v < 0 ? 0 : v;
}

SrmGuidaModule::SrmGuidaModule()
    : SinglePortModule("srmguida", meshtastic_PortNum_TEXT_MESSAGE_APP), concurrency::OSThread("SrmGuida"),
      traccia(srm::TRACCIA, srm::N_TRACCIA, srm::SENTIERI, srm::N_SENTIERI, srm::COMUNE, srm::N_COMUNE),
      app(traccia, srm::BIVI, srm::N_BIVI, pettoraleDaNome())
{
    if (inputBroker)
        inputObserver.observe(inputBroker);
    setIntervalFromNow(3000);
}

void SrmGuidaModule::coronaLunga()
{
    app.tasto(srm::Tasto::CORONA_LUNGA, millis());
    srm::Azioni a = app.prendiAzioni();
    esegui(a);
    portaAvanti();
}

// chiamata da Power.cpp quando il PMU segnala la pressione lunga della corona
void srmCoronaLunga()
{
    if (srmGuidaModule)
        srmGuidaModule->coronaLunga();
}

void SrmGuidaModule::portaAvanti()
{
    // accende lo schermo e mette in primo piano la pagina SRM
    uint32_t ora = millis();
    if (ora - ultimaSveglia > 1500) {
        powerFSM.trigger(EVENT_PRESS);
        ultimaSveglia = ora;
    }
#if HAS_SCREEN
    if (ora - ultimoDisegno > 1500) { // la pagina SRM non è quella mostrata
        requestFocus();
        UIFrameEvent e;
        e.action = UIFrameEvent::Action::REGENERATE_FRAMESET;
        notifyObservers(&e);
    }
#endif
}

void SrmGuidaModule::vibra(srm::Vibra v)
{
#ifdef HAS_DRV2605
    // effetti della libreria DRV2605 (1 click forte, 47 vibrazione, 14 vibrazione forte, 52 pulsante); 0x80|n = pausa n*10 ms
    uint8_t seq[8] = {0};
    switch (v) {
    case srm::Vibra::PREAVVISO: {
        uint8_t s[] = {47, 0x80 | 10, 47};
        memcpy(seq, s, sizeof s);
        break;
    }
    case srm::Vibra::INDICAZIONE: {
        uint8_t s[] = {14, 0x80 | 15, 14};
        memcpy(seq, s, sizeof s);
        break;
    }
    case srm::Vibra::ORA: {
        uint8_t s[] = {1, 0x80 | 8, 1, 0x80 | 8, 1};
        memcpy(seq, s, sizeof s);
        break;
    }
    case srm::Vibra::ERRORE: {
        uint8_t s[] = {14, 0x80 | 20, 14, 0x80 | 20, 14, 0x80 | 20, 14};
        memcpy(seq, s, sizeof s);
        break;
    }
    case srm::Vibra::TOCCO:
        seq[0] = 7;
        break;
    case srm::Vibra::SOS:
        seq[0] = 52;
        seq[1] = 52;
        break;
    default:
        return;
    }
    for (uint8_t i = 0; i < 8; i++)
        drv.setWaveform(i, seq[i]);
    drv.go();
#else
    (void)v;
#endif
}

void SrmGuidaModule::suona(srm::Suono s)
{
#ifdef HAS_I2S
    if (!audioThread)
        return;
    const char *r = s == srm::Suono::PREAVVISO ? RT_PREAVVISO
                    : s == srm::Suono::BIVIO   ? RT_BIVIO
                    : s == srm::Suono::ERRORE  ? RT_ERRORE
                    : s == srm::Suono::POSITIVO ? RT_POSITIVO
                    : s == srm::Suono::SOS     ? RT_SOS
                                               : nullptr;
    if (!r)
        return;
    audioThread->stop();
    audioThread->beginRttl(r, strlen(r));
    suonando = true;
#else
    (void)s;
#endif
}

void SrmGuidaModule::inviaTesto(const std::string &s, uint8_t salti)
{
    meshtastic_MeshPacket *p = allocDataPacket();
    if (!p)
        return;
    p->to = NODENUM_BROADCAST;
    p->channel = 0;
    p->hop_limit = salti;
    p->want_ack = false;
    p->decoded.payload.size = std::min(s.size(), sizeof(p->decoded.payload.bytes));
    memcpy(p->decoded.payload.bytes, s.data(), p->decoded.payload.size);
    service->sendToMesh(p, RX_SRC_LOCAL, true);
    LOG_INFO("SRM: inviato «%s»", s.c_str());
}

// frasi registrate (srm_voce.cpp): se ci sono tutte si dicono in fila, altrimenti si usa il suono breve
bool SrmGuidaModule::parla(std::vector<std::string> &pezzi, bool urgente)
{
#ifdef HAS_I2S
    if (pezzi.empty() || !audioThread)
        return false;
    for (auto &p : pezzi)
        if (!srm::trovaClip(p.c_str()))
            return false;
    if (urgente) {
        codaVoce.clear();
        audioThread->stop();
        suonando = false;
    }
    codaVoce.insert(codaVoce.end(), pezzi.begin(), pezzi.end());
    return true;
#else
    (void)pezzi;
    (void)urgente;
    return false;
#endif
}

void SrmGuidaModule::esegui(srm::Azioni &a)
{
    if (a.vibra != srm::Vibra::NESSUNA)
        vibra(a.vibra);
    bool urgente = a.vibra == srm::Vibra::ERRORE || a.vibra == srm::Vibra::SOS;
    if (!parla(a.voce, urgente) && a.suono != srm::Suono::NESSUNO)
        suona(a.suono);
    for (auto &m : a.messaggi)
        inviaTesto(m, 3); // SOS e avvisi arrivano alla base anche passando per due ripetitori
    for (auto &d : a.diario)
        LOG_INFO("SRM: %s", d.c_str());
    if (a.sveglia)
        portaAvanti();
    if (!codaVoce.empty())
        setIntervalFromNow(20); // la prima frase parte subito
#if HAS_SCREEN
    UIFrameEvent e;
    e.action = UIFrameEvent::Action::REDRAW_ONLY;
    notifyObservers(&e);
#endif
}

int32_t SrmGuidaModule::runOnce()
{
    uint32_t ora = millis();
#ifdef HAS_I2S
    if (suonando && audioThread) {
        if (audioThread->isPlaying())
            return 20; // suoni e frasi vanno «pompati» spesso finché suonano
        audioThread->stop();
        suonando = false;
    }
    if (!codaVoce.empty() && audioThread) {
        const srm::Clip *c = srm::trovaClip(codaVoce.front().c_str());
        codaVoce.erase(codaVoce.begin());
        if (c) {
            audioThread->beginWav(c->dati, c->len);
            suonando = true;
            return 20;
        }
    }
#endif
    if (primaVolta) {
        primaVolta = false;
        app.pettorale = pettoraleDaNome();
        portaAvanti();
    }
    if (ora - ultimoSecondo < 1000)
        return 1000 - (ora - ultimoSecondo);
    ultimoSecondo = ora;

    // posizione nuova dal GPS (Meshtastic la aggiorna in localPosition)
    srm::Fix f;
    bool nuova = false;
    if (localPosition.latitude_i != 0 && (localPosition.time != ultimoTempoPos || localPosition.latitude_i != ultimaPos)) {
        ultimoTempoPos = localPosition.time;
        ultimaPos = localPosition.latitude_i;
        double dop = localPosition.HDOP ? localPosition.HDOP / 100.0 : localPosition.PDOP ? localPosition.PDOP / 100.0 : 2.0;
        f.lat = localPosition.latitude_i * 1e-7;
        f.lon = localPosition.longitude_i * 1e-7;
        f.acc = std::max(3.0, dop * 4.0);
        f.t = ora;
        nuova = true;
    }
    int32_t oraLocale = -1;
    uint32_t rtc = getValidTime(RTCQuality::RTCQualityDevice, true);
    if (rtc > 0)
        oraLocale = (int32_t)(rtc % 86400);
    int batt = powerStatus ? powerStatus->getBatteryChargePercent() : -1;
    app.secondo(nuova ? &f : nullptr, ora, oraLocale, batt);
    srm::Azioni a = app.prendiAzioni();
    esegui(a);
    if (app.tieniAcceso(ora))
        portaAvanti();
    return codaVoce.empty() && !suonando ? 1000 : 20;
}

ProcessMessage SrmGuidaModule::handleReceived(const meshtastic_MeshPacket &mp)
{
    if (isFromUs(&mp))
        return ProcessMessage::CONTINUE;
    const auto &p = mp.decoded;
    char testo[sizeof(p.payload.bytes) + 1];
    size_t n = std::min((size_t)p.payload.size, sizeof(p.payload.bytes));
    memcpy(testo, p.payload.bytes, n);
    testo[n] = 0;
    if (strncmp(testo, "SRM ", 4) != 0)
        return ProcessMessage::CONTINUE; // messaggi normali: li gestisce Meshtastic
    app.testoRicevuto(testo, millis());
    srm::Azioni a = app.prendiAzioni();
    esegui(a);
    // i messaggi SRM degli altri atleti non devono comparire come notifiche sull'orologio
    return ProcessMessage::STOP;
}

#if HAS_SCREEN
bool SrmGuidaModule::interceptingKeyboardInput()
{
    return millis() - ultimoDisegno < 1500 && (int32_t)(millis() - cediInputFino) >= 0;
}

int SrmGuidaModule::handleInputEvent(const InputEvent *event)
{
    if (!interceptingKeyboardInput())
        return 0;
    srm::Tasto t;
    switch (event->inputEvent) {
    case INPUT_BROKER_USER_PRESS:
        t = srm::Tasto::TOCCO;
        break;
    case INPUT_BROKER_LEFT:
        t = srm::Tasto::SINISTRA;
        break;
    case INPUT_BROKER_RIGHT:
        t = srm::Tasto::DESTRA;
        break;
    case INPUT_BROKER_CANCEL:
        t = srm::Tasto::CORONA;
        break;
    case INPUT_BROKER_SELECT_LONG:
        t = event->kbchar == 'S' ? srm::Tasto::CORONA_LUNGA : srm::Tasto::PREMUTO_LUNGO;
        break;
    case INPUT_BROKER_SELECT:
        t = srm::Tasto::PREMUTO_LUNGO;
        break;
    case INPUT_BROKER_UP:
        cediInputFino = millis() + 60000; // per un minuto si naviga nelle pagine di Meshtastic
        return 0;
    default:
        return 0;
    }
    app.tasto(t, millis());
    srm::Azioni a = app.prendiAzioni();
    esegui(a);
    return 1;
}

// la superficie di disegno dell'app sopra OLEDDisplay di Meshtastic (TFT con zone colore)
class TelaOled : public srm::Tela
{
  public:
    TelaOled(OLEDDisplay *d, int16_t ox, int16_t oy) : d(d), ox(ox), oy(oy) {}
    int larghezza() override { return d->getWidth(); }
    int altezza() override { return d->getHeight(); }
    void pulisci() override { d->clear(); }
    void nero(bool n) override { d->setColor(n ? BLACK : WHITE); }
    void linea(int x0, int y0, int x1, int y1) override { d->drawLine(x0 + ox, y0 + oy, x1 + ox, y1 + oy); }
    void rettangolo(int x, int y, int w, int h, bool pieno) override
    {
        if (pieno)
            d->fillRect(x + ox, y + oy, w, h);
        else
            d->drawRect(x + ox, y + oy, w, h);
    }
    void cerchio(int x, int y, int r, bool pieno) override
    {
        if (pieno)
            d->fillCircle(x + ox, y + oy, r);
        else
            d->drawCircle(x + ox, y + oy, r);
    }
    void triangolo(int x0, int y0, int x1, int y1, int x2, int y2) override
    {
        d->fillTriangle(x0 + ox, y0 + oy, x1 + ox, y1 + oy, x2 + ox, y2 + oy);
    }
    static const uint8_t *font(srm::Dim k) { return k == srm::Dim::PICCOLO ? FONT_SMALL : FONT_LARGE; }
    void testo(int x, int y, const char *s, srm::Dim k, srm::Allinea a) override
    {
        d->setFont(font(k));
        d->setTextAlignment(a == srm::Allinea::CENTRO ? TEXT_ALIGN_CENTER : a == srm::Allinea::DESTRA ? TEXT_ALIGN_RIGHT : TEXT_ALIGN_LEFT);
        d->drawString(x + ox, y + oy, s);
    }
    int larghezzaTesto(const char *s, srm::Dim k) override
    {
        d->setFont(font(k));
        return d->getStringWidth(s, strlen(s), true);
    }
    int altezzaTesto(srm::Dim k) override { return k == srm::Dim::PICCOLO ? FONT_HEIGHT_SMALL : FONT_HEIGHT_LARGE; }
    void zona(int x, int y, int w, int h, uint16_t on, uint16_t off) override
    {
        graphics::registerTFTColorRegionDirect(x + ox, y + oy, w, h, on, off);
    }

  private:
    OLEDDisplay *d;
    int16_t ox, oy;
};

void SrmGuidaModule::drawFrame(OLEDDisplay *display, OLEDDisplayUiState *state, int16_t x, int16_t y)
{
    (void)state;
    ultimoDisegno = millis();
    TelaOled t(display, x, y);
    app.disegna(t, millis());
    display->setColor(WHITE);
}
#else
int SrmGuidaModule::handleInputEvent(const InputEvent *event)
{
    (void)event;
    return 0;
}
#endif

#endif
