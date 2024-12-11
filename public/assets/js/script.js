AllMonsters = [];

class MythicForgeWindow {
    constructor() {

    }

    createWindow(title, content, options) {
        this.title = title;
        this.content = content;
        this.options = options;
        var html = `<div class="mythicForgeWindow" style='display:none'>
            <div class="windowHeader">${this.title}</div>
            <div class="windowContent">${this.content}</div>
            <div class="windowClose" title="Close this window"><i class='bx bx-x'></i></div>
        </div>`;
        this.el = $(html);
        $("body").append(this.el);
        this.centerDivToScreen();
        this.initEvents();
    }

    monsterCard(name,source){
        var monster = getMonsterByName(name,source);
        if(monster){
            var html = `
            <div class="monsterCardImage"><img src="${monster.img_url}"></div>
            <div class="monsterCardInfo">
                <div class="monsterCardInfoItem"><span class="monsterCardInfoLabel">Size:</span> ${monster.size}</div>
                <div class="monsterCardInfoItem"><span class="monsterCardInfoLabel">Type:</span> ${monster.type}</div>
                <div class="monsterCardInfoItem"><span class="monsterCardInfoLabel">Alignment:</span> ${monster.alignment}</div>
                <div class="monsterCardInfoItem"><span class="monsterCardInfoLabel">AC:</span> ${monster.ac}</div>
                <div class="monsterCardInfoItem"><span class="monsterCardInfoLabel">HP:</span> ${monster.hp}</div>
                <div class="monsterCardInfoItem"><span class="monsterCardInfoLabel">Speed:</span> ${monster.speed}</div>
                <div class="monsterCardInfoItem"><span class="monsterCardInfoLabel">CR:</span> ${monster.cr}</div>
                <div class="monsterCardInfoItem"><span class="monsterCardInfoLabel">Source:</span> ${monster.source}</div>
                <div class="monsterCardInfoItem"><span class="monsterCardInfoLabel">Page:</span> ${monster.page}</div>
            </div>
            </div>`;
            this.el.find(".windowContent").html(html);
            this.el.fadeIn();
        }
    }

    initEvents() {
        var that = this;
        this.el.on("click tap", function(evt) {
            if ($(this).hasClass("focused")) return;
            $(this).removeClass("focused");
            $(this).css("z-index", that.mythicForgeWindowIndex()).addClass("focused");
        });

        this.el.on("click tap", ".windowClose", function(evt) {
            $(this).parent().css("display", "none");
        });

        this.el.draggable({containment: "parent",onStart: function() {
            $(this).css("z-index", that.mythicForgeWindowIndex());
        }});
    }

    mythicForgeWindowIndex(){
        var highestZ = 0;
        $(".mythicForgeWindow").each(function() {
            var currentZ = parseInt($(this).css("z-index"), 10);
            if (currentZ > highestZ)
                highestZ = currentZ;
        });
        return highestZ;
    }

    centerDivToScreen(){
        var $window = $(window);
        var windowWidth = $window.width();
        var windowHeight = $window.height();

        // Ensure the element is visible to get correct dimensions
        this.el.css("visibility", "hidden").show();
        var divWidth = this.el.outerWidth();
        var divHeight = this.el.outerHeight();

        var left = Math.max(0, (windowWidth - divWidth) / 2);
        var top = Math.max(0, (windowHeight - divHeight) / 2);

        this.el.css({
            "position": "absolute",
            "left": left + "px",
            "top": top + "px",
            "visibility": "visible"
        }).hide();
    }
}

// Document ready function
$.when( $.ready ).then(function() {

    DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY,1).then(function(data){
        AllMonsters = data;
    });

    // Open and close the bestiary window
    $(".showBestiary").on("click tap", function(evt) {
        if ($(".bestiaryWindow").length == 0) {
            var bestiaryWindow = new MythicForgeWindow();
            bestiaryWindow.createWindow("Bestiary", `
                <input type="search" id="lst_search" class="mythicForgeInput searchBestiary" placeholder="Search here">
            `);
            bestiaryWindow.el.addClass("bestiaryWindow");
            bestiaryWindow.el.fadeIn();
        }else{
            if ($(".bestiaryWindow").css("display") == "block" && $(".bestiaryWindow").hasClass("focused")) {
                $(".bestiaryWindow").css("display", "none");
                return;
            }else{
                $(".bestiaryWindow").fadeIn();
            }
        }
    });
});

function createMonsterCard(monster,source){
    var monsterCard = new MythicForgeWindow();
    var theMonster = getMonsterByName(monster,source);
    monsterCard.createWindow(theMonster.name, "");
    monsterCard.monsterCard(theMonster.name,theMonster.source);
}

// Function to center a div to the screen
function centerDivToScreen(div){
    var divWidth = $(div).width();
    var divHeight = $(div).height();
    var windowWidth = $(window).width();
    var windowHeight = $(window).height();
    $(div).css({
        "left": windowWidth/2 - divWidth/2,
        "top": windowHeight/2 - divHeight/2
    });
}

function getMonsterByName(name,source){
    return AllMonsters.find(monster => monster.name.toLowerCase() === name.toLowerCase() && monster.source.toLowerCase() === source.toLowerCase());
}