import DiceBox from "/assets/plugins/dice-box/dist/dice-box.es.min.js";

/**
 * @file script.js
 * @fileoverview The main script file for Mythic Forge application, handling monster data management,
 * window creation, and UI interactions.
 *
 * @requires jQuery
 * @requires jQuery UI
 * @requires Renderer
 * @requires Parser
 * @requires DataLoader
 * @requires UrlUtil
 *
 * @global {boolean} SRDonly - Flag to determine if only SRD content should be displayed
 *
 * @author Shaun Scholtz
 * @version 0.0.1
 * @license AGPLv3
 *
 * @example
 * // Create a new window
 * const window = new MythicForgeWindow();
 * window.createWindow('Title', 'Content');
 *
 * // Display monster stat block
 * createMonsterStatBlock('Goblin', 'MM');
 */
var AllMonsters = [];
var SRDonly = false;
let diceBox, RollboxWindow;

//Override the dice roller to use the dice box
Renderer.dice.bindOnclickListener = function(ele) {
    ele.addEventListener("click", (evt) => {
        let eleDice = null;
        if (evt.target.hasAttribute("data-packed-dice")) {
            eleDice = evt.target;
        } else if (evt.target.parentElement && evt.target.parentElement.hasAttribute("data-packed-dice")) {
            eleDice = evt.target.parentElement;
        }

        if (!eleDice) return;

        evt.preventDefault();
        evt.stopImmediatePropagation();

        const packed = JSON.parse(eleDice.getAttribute("data-packed-dice"));

        if(packed.rollable === false) return;
        console.log(packed);
        const toRoll = packed.toRoll.replace(/\+0/g, "").replace(/-0/g, "");
        const displayText = packed.subType;

        RollboxWindow.show();

        //TODO: Support for advantage/disadvantage rolls
        //TODO: Show text in the roll box

        diceBox.onRollComplete = (rollResult)=>{
            console.log(displayText,rollResult)
        };

        diceBox.roll(toRoll).then((result) => {

        });
    });
}

RollboxWindow = new MythicForgeWindow();
RollboxWindow.createWindow('Roll Box', "");
RollboxWindow.el.addClass("rollboxWindow notInitialized");
RollboxWindow.el.show();

// Document ready function
$.when( $.ready ).then(function() {

    //Load all monster data from 5etools
    DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY,1).then(function(data){
        AllMonsters = data;
    });

    // Open and close the bestiary window
    $(".showBestiary").on("click tap", function(evt) {
        if ($(".bestiaryWindow").length == 0) {
            var bestiaryWindow = new MythicForgeWindow();
            bestiaryWindow.createWindow("Bestiary", `
                <div class="bestiaryContent">
                <input type="search" id="lst_search" class="mythicForgeInput searchBestiary" placeholder="Search here">
                <table class="bestiaryList">
                    <thead>
                        <tr>
                            <th>Monster</th>
                            <th>Type</th>
                            <th>CR</th>
                            <th>Source</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
                </div>
            `);

            bestiaryWindow.el.addClass("bestiaryWindow");
            bestiaryWindow.el.fadeIn();

            $(".bestiaryWindow").on("click tap", ".bestiaryList .bestiaryItem", function(evt) {
                var monsterName = $(this).data("name");
                var monsterSource = $(this).data("source");
                createMonsterStatBlock(monsterName,monsterSource);
            });

            let searchTimeout;
            $(".bestiaryWindow").on("keyup", ".searchBestiary", function(evt) {
                const search = $(this).val().toLowerCase();
                if (search.length < 3) return;

                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    const bestiaryList = $(".bestiaryWindow .bestiaryList");
                    bestiaryList.find("tbody").remove();
                    const tbody = $("<tbody></tbody>");

                    var results = SearchAll(search, "monster");
                    $.each(results, function(i, monster){
                        if (i > 100) return;
                        var monsterAlignment = Renderer.monster.getTypeAlignmentPart(monster);
                        var monsterCR = (monster.cr)?monster.cr:"-";
                        if (typeof monsterCR == "object") monsterCR = monsterCR.cr;
                        var tr = `<tr class='bestiaryItem' data-name='${monster.name}' data-source='${monster.source}'>
                            <td>${monster.name}</td>
                            <td>${monsterAlignment}</td>
                            <td>${monsterCR}</td>
                            <td title='${monster.source?Parser.sourceJsonToFull(monster.source):"N/A"}'>${monster.source?monster.source:"-"}</td>
                        </tr>`;
                        tbody.append(tr);

                        if (monster.reprintedAs){
                            $.each(monster.reprintedAs, function(r, reprinted){
                                var reprintedName = reprinted.split("|")[0];
                                var reprintedSource = reprinted.split("|")[1];
                                var tr = `<tr class='bestiaryItem' data-name='${reprintedName}' data-source='${reprintedSource}'>
                                    <td>${reprintedName}</td>
                                    <td>${monsterAlignment}</td>
                                    <td>${monsterCR}</td>
                                    <td title='${reprintedSource?Parser.sourceJsonToFull(reprintedSource):"N/A"}'>${reprintedSource?reprintedSource:"-"}</td>
                                </tr>`;
                                tbody.append(tr);
                            });
                        }
                    });
                    bestiaryList.append(tbody);
                }, 500);
            });
        }else{
            if ($(".bestiaryWindow").css("display") == "block" && $(".bestiaryWindow").hasClass("focused")) {
                $(".bestiaryWindow").css("display", "none");
                return;
            }else{
                $(".bestiaryWindow").fadeIn();
            }
        }
    });

    diceBox = new DiceBox(".rollboxWindow .windowContent", {
        assetPath: "/assets/",
        theme: "wooden",
        themeColor: "#FE3E03FF",
        scale: 20
    });

    diceBox.init().then(() => {
        RollboxWindow.el.hide();
        RollboxWindow.el.removeClass("notInitialized");
    });

    console.log(diceBox);
});

/**
 * Searches through all monsters based on a search term and returns matching results
 * @param {string} term - The search term to look for in monster properties
 * @param {string} where - Currently unused parameter indicating search location
 * @returns {Array} Array of monster objects that match the search criteria
 * @description Searches monster names, sources and types for matches to the search term.
 * If SRDonly flag is true, only returns monsters from the SRD (System Reference Document).
 * The search is case-insensitive and uses partial matching.
 */
function SearchAll(term, where) {
    var results = [];

    $.each(AllMonsters, function(monsterIndex, monster){
        if (SRDonly)
            if (typeof monster.srd != "undefined"){
                //if srd is true, then the monster is from the srd
                if (!monster.srd){
                    //remove the monster from the list
                    return;
                }
            }else{
                //remove the monster from the list
                return;
            }

        var monsterName = monster.name.toLowerCase();
        var monsterSource = monster.source.toLowerCase();
        var monsterType = "";

        if (monster.type.type) {
            if (typeof monster.type.type != "string") {
                if (monster.type.type.choose)
                    monsterType = monster.type.type.choose.join(", ").toLowerCase();
            }else{
                monsterType = monster.type.type.toLowerCase();
            }
        }

        if (monsterName.includes(term) || monsterSource.includes(term) || monsterType.includes(term)) {
            results.push(monster);
        }
    });

    return results;
}

/**
 * Creates and displays a monster stat block window using MythicForge
 * @param {string} monster - The name of the monster to display
 * @param {string} source - The source book or reference where the monster data comes from
 * @returns {void} - Does not return a value
 * @async - Contains asynchronous operation via Promise
 */
function createMonsterStatBlock(monster,source){
    var monsterStatBlock = new MythicForgeWindow();
    monsterStatBlock.monsterStatBlock(monster,source);
}
