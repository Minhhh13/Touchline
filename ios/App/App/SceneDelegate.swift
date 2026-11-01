import UIKit
import Capacitor

@objc(TouchlineImageSharePlugin)
public class TouchlineImageSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TouchlineImageSharePlugin"
    public let jsName = "TouchlineImageShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "shareImage", returnType: CAPPluginReturnPromise)
    ]

    @objc func shareImage(_ call: CAPPluginCall) {
        guard let encoded = call.getString("data"),
              let data = Data(base64Encoded: encoded),
              let image = UIImage(data: data) else {
            call.reject("The image could not be shared.")
            return
        }

        DispatchQueue.main.async { [weak self] in
            let sheet = UIActivityViewController(activityItems: [image], applicationActivities: nil)
            var presenter = self?.bridge?.viewController
            while let presented = presenter?.presentedViewController {
                if presented is UIActivityViewController {
                    call.reject("Can't share while sharing is in progress")
                    return
                }
                presenter = presented
            }

            if let popover = sheet.popoverPresentationController, let presenterView = presenter?.view {
                popover.sourceView = presenterView
                popover.sourceRect = CGRect(x: presenterView.bounds.midX, y: presenterView.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            sheet.completionWithItemsHandler = { activityType, completed, _, error in
                if let error {
                    call.reject("Error sharing image", nil, error)
                } else {
                    call.resolve([
                        "activityType": activityType?.rawValue ?? "",
                        "completed": completed
                    ])
                }
            }
            presenter?.present(sheet, animated: true)
        }
    }
}

final class TouchlineBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(TouchlineImageSharePlugin())
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = TouchlineBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
