const path = require("path");
const fs = require("fs");
const glob = require("glob");
const xml = require("xmldoc");
const { DOMParser, XMLSerializer } = require("xmldom");

function findAndroidAppFolder(folder) {
    const nested = path.join("android", "app");
    return fs.existsSync(path.join(folder, nested)) ? nested : null;
}

function findManifest(folder) {
    return glob.sync(path.join("**", "AndroidManifest.xml"), {
        cwd: folder,
        ignore: ["node_modules/**", "**/build/**", "**/debug/**"],
    })[0];
}

function readManifest(manifestPath) {
    return new xml.XmlDocument(fs.readFileSync(manifestPath, "utf8"));
}

const getPackageName = (manifest) => manifest.attr.package;

function getApplicationClassName(folder) {
    const files = glob.sync("**/*.{java,kt}", { cwd: folder });

    const matches = files
        .map((filePath) => fs.readFileSync(path.join(folder, filePath), "utf8"))
        .map((file) => file.match(/class\s+(\w+)\s*[:\s]+Application/))
        .filter(Boolean);

    return matches.length ? matches[0][1] : null;
}

function findGradleFile(folder) {
    return glob.sync(path.join("**", "build.gradle"), {
        cwd: folder,
        ignore: ["node_modules/**", "**/build/**"],
    })[0];
}

function readGradle(gradlePath) {
    const gradleFile = fs.readFileSync(gradlePath, "utf8");
    let packageId = "";
    gradleFile.split(/\r?\n/).forEach((line) => {
        if (line.includes("namespace") || line.includes("applicationId")) {
            packageId = line.split(/\s+/)[1].replace(/['";]/g, "");
        }
    });
    return packageId;
}

function findStringsXml(folder) {
    return glob.sync(path.join("**", "strings.xml"), {
        cwd: folder,
        ignore: ["node_modules/**", "**/build/**"],
    })[0];
}

function updateConfigurationFile(confFilePath) {
    console.log("Updating strings.xml...");
    const configEntries = [
        { key: "smisdk_apikey", type: "string" },
        { key: "smisdk_show_messaging", type: "bool", value: "true" },
        { key: "smisdk_exclusion_domin", type: "array" },
    ];

    let stringsXmlDoc = fs.readFileSync(confFilePath, "utf8");
    const resourcesEndIndex = stringsXmlDoc.search("</resources>");

    configEntries.forEach(({ key, type, value = "" }) => {
        if (!stringsXmlDoc.includes(key)) {
            stringsXmlDoc =
                stringsXmlDoc.slice(0, resourcesEndIndex) +
                `\n<${type} name="${key}">${value}</${type}>` +
                stringsXmlDoc.slice(resourcesEndIndex);
        }
    });

    fs.writeFileSync(confFilePath, stringsXmlDoc, "utf8");
}

function updateManifestFile(manifestPath, applicationClassName) {
    console.log("Updating AndroidManifest.xml...");
    const manifestXmlDoc = new DOMParser().parseFromString(
        fs.readFileSync(manifestPath, "utf8")
    );
    const applicationNode =
        manifestXmlDoc.getElementsByTagName("application")[0];

    if (
        applicationNode.getAttribute("android:name") !==
        `.${applicationClassName}`
    ) {
        applicationNode.setAttribute(
            "android:name",
            `.${applicationClassName}`
        );
        fs.writeFileSync(
            manifestPath,
            new XMLSerializer().serializeToString(manifestXmlDoc),
            "utf8"
        );
    }
}

function projectConfigAndroid(folder) {
    const androidAppFolder = findAndroidAppFolder(folder);
    if (!androidAppFolder) {
        console.error("Android app folder not found.");
        return;
    }

    const sourceDir = path.join(folder, androidAppFolder);
    const manifestPath = findManifest(sourceDir);
    if (!manifestPath) {
        console.error("AndroidManifest.xml not found.");
        return;
    }

    let applicationClassName = getApplicationClassName(sourceDir + "/src/main");
    if (!applicationClassName) {
        console.warn("Application class not found. Skipping update.");
        return;
    }

    console.log("Detected application class:", applicationClassName);
    const manifest = readManifest(manifestPath);
    let packageName =
        getPackageName(manifest) || readGradle(findGradleFile(sourceDir));

    if (!packageName) {
        console.error("Failed to determine package name.");
        return;
    }

    console.log("Package Name:", packageName);
    const packageFolder = packageName.replace(/\./g, path.sep);
    const mainApplicationPath = path.join(
        sourceDir,
        `src/main/java/${packageFolder}/${applicationClassName}.java`
    );

    if (!fs.existsSync(mainApplicationPath)) {
        console.warn(`Application file not found: ${mainApplicationPath}`);
        return;
    }

    let appFile = fs.readFileSync(mainApplicationPath, "utf8");
    if (!appFile.includes("SmiSdkReactPackage")) {
        console.log("Injecting SmiSdkReactPackage into MainApplication.java");

        const smiPackageName =
            "\nimport com.datami.smisdk_plugin.SmiSdkReactPackage;";
        const smiInitCode = `
    SmiSdkReactPackage smiSdkReactPackage = new SmiSdkReactPackage();
    packages.add(smiSdkReactPackage);
    `;

        // Ajuste para RN 0.74: PackageList.apply para adicionar pacotes
        const regexAbove073 = /PackageList\(this\)\.packages\.apply/;
        if (regexAbove073.test(appFile)) {
            appFile = appFile.replace(
                regexAbove073,
                (match) => `${match} {\n    add(smiSdkReactPackage);\n}`
            );
        }

        // Adiciona import
        appFile = smiPackageName + appFile;
        fs.writeFileSync(mainApplicationPath, appFile, "utf8");
    } else {
        console.log("SmiSdkReactPackage already exists.");
    }

    updateManifestFile(manifestPath, applicationClassName);
    const stringsXmlPath = findStringsXml(sourceDir);
    if (stringsXmlPath) {
        updateConfigurationFile(stringsXmlPath);
    }
}

projectConfigAndroid("../..");
