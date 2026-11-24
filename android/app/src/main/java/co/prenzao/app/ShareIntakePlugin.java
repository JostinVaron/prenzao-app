package co.prenzao.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Recibe texto compartido desde otras apps (WhatsApp → Compartir → Prenzao)
 * y lo entrega a la app web para armar el pedido automáticamente.
 */
@CapacitorPlugin(name = "ShareIntake")
public class ShareIntakePlugin extends Plugin {
    static String pending = null;

    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject r = new JSObject();
        if (pending != null) r.put("text", pending);
        pending = null;
        call.resolve(r);
    }

    public void deliver(String text) {
        JSObject d = new JSObject();
        d.put("text", text);
        pending = null;
        notifyListeners("shared", d, true);
    }
}
