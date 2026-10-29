#pragma once
#ifdef SRM_GUIDA
#include "Observer.h"
#include "SinglePortModule.h"
#include "concurrency/OSThread.h"
#include "input/InputBroker.h"
#include "srm_app.h"

// Guida SRM sul T-Watch Ultra: guida sul percorso, pagine dello schermo, SOS e avvisi alla base sul canale SRM.
// La logica sta in srm_app/srm_guida (provata sul PC); qui solo il collegamento a GPS, schermo, vibrazione, radio.
class SrmGuidaModule : public SinglePortModule, public Observable<const UIFrameEvent *>, private concurrency::OSThread
{
  public:
    SrmGuidaModule();
    void coronaLunga(); // corona tenuta premuta: SOS (chiamata dal PMU, funziona anche a schermo spento)
#if HAS_SCREEN
    virtual bool wantUIFrame() override { return true; }
    virtual void drawFrame(OLEDDisplay *display, OLEDDisplayUiState *state, int16_t x, int16_t y) override;
    virtual bool interceptingKeyboardInput() override;
#endif
    virtual Observable<const UIFrameEvent *> *getUIFrameObservable() override { return this; }

  protected:
    virtual int32_t runOnce() override;
    virtual ProcessMessage handleReceived(const meshtastic_MeshPacket &mp) override;

  private:
    int handleInputEvent(const InputEvent *event);
    CallbackObserver<SrmGuidaModule, const InputEvent *> inputObserver =
        CallbackObserver<SrmGuidaModule, const InputEvent *>(this, &SrmGuidaModule::handleInputEvent);

    void esegui(srm::Azioni &a);
    void vibra(srm::Vibra v);
    void suona(srm::Suono s);
    void inviaTesto(const std::string &s, uint8_t salti);
    void portaAvanti();
    static int pettoraleDaNome();

    srm::Traccia traccia;
    srm::App app;
    uint32_t ultimoSecondo = 0;
    uint32_t ultimoDisegno = 0;     // per sapere se la pagina SRM è quella sullo schermo
    uint32_t ultimaSveglia = 0;
    uint32_t cediInputFino = 0;     // swipe verso l'alto: per un minuto i tasti tornano a Meshtastic
    int32_t ultimaPos = 0;          // per riconoscere una posizione nuova
    uint32_t ultimoTempoPos = 0;
    bool suonando = false;
    std::vector<std::string> codaVoce; // frasi registrate ancora da dire
    bool parla(std::vector<std::string> &pezzi, bool urgente);
    bool primaVolta = true;
};

extern SrmGuidaModule *srmGuidaModule;
#endif
